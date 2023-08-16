from collections import defaultdict
from copy import copy
import json

from odoo import api, models, fields

"""
Global Variables shouldn't be used. This is purely written here for the sake of the PoC. Ideally we would want to use a fast key-value storage
database here such as Redis to cache all incoming strokes. This helps up to avoid the overhead of 10 database queries per second while a user
is drawing. This cache stores all strokes that have been made during a session and it flushes all strokes to the database in one go after
batching them up to perform only a single database request for multiple previous strokes.
"""
MAX_STROKE_HISTORY = 2500
stroke_cache = defaultdict(list)
strokes_cache_len = 0


class Json(fields.Field):
    """ JSON Field that contain unstructured information in json PostgreSQL column.
    This field is not meant to be used in search or on compute method. It is only
    meant to be used to store data in json format. The reason behind making a new
    field in JSON format over JSONB is that JSONB is slower to ingest and we are
    not going to search on it.
    """

    type = 'json'
    column_type = ('json', 'json')


class SketchpadStrokesCollaboration(models.AbstractModel):
    """ Mixin for optimizing strokes for a collaborative sketchpad """
    _name = 'knowledge_canvas.collaborative_strokes.mixin'
    _description = 'Cached strokes for a sketchpad'
    _stroke_length = 0

    def publish_sketchpad_stroke_actions(self, sketchpad_id, stroke_actions):
        """ Publishes the stroke actions to the bus and caches them. This method is called
        by the client when a user draws on the sketchpad. If there is any stroke that involves
        deletion or if the cache exceeds MAX_STROKE_HISTORY, then the cache is flushed to the database.
        """
        global strokes_cache_len
        global stroke_cache
        channel = f'knowledge_canvas_sketchpad_stroke_{sketchpad_id}'
        stroke_cache[sketchpad_id] += stroke_actions
        message = {'stroke_actions': stroke_actions, 'sketchpad_id': sketchpad_id}
        self.env['bus.bus']._sendone(channel, 'update_canvas', message)
        strokes_cache_len += len(stroke_actions)
        has_deletion = False
        for stroke in stroke_actions:
            if stroke['action'] == 'deleteOne' or stroke['action'] == 'deleteMany':
                has_deletion = True
                break
        if strokes_cache_len > MAX_STROKE_HISTORY or has_deletion:
            self.sync_cache_to_database()

    def join_sketchpad_session(self, sketchpad_id):
        """ Join the current user to the sketchpad session. This method is called by
        the client and it returns the cached strokes for a sketchpad
        """
        global stroke_cache
        global strokes_cache_len
        self.ensure_one()
        return {
            'strokes': stroke_cache[sketchpad_id],
        }

    @api.model
    def sync_cache_to_database(self):
        """ Syncs the cache to the database. This method is called when the cache exceeds
        MAX_STROKE_HISTORY or during deletions and in cases where a user closes the window. """
        global strokes_cache_len
        global stroke_cache
        # copies the cache. This is important because we are going to clear the cache so it shouldnt clear any incoming data
        values_to_sync = copy(stroke_cache)
        strokes_cache_len = 0
        stroke_cache.clear()
        for sketchpad_id, _ in values_to_sync.items():
            strokes_to_add = []
            deleted_indexes = []
            undo_indexes = []
            restore_indexes = []
            sub_values_to_sync = [
                values_to_sync[sketchpad_id][i : i + 100]
                for i in range(0, len(values_to_sync[sketchpad_id]), 100)
            ]
            for sub in sub_values_to_sync:
                for stroke in sub:
                    strokes_to_add.append({
                        'sketchpad_seq_id': sketchpad_id,
                        'user_identifier': stroke['user'],
                        'local_stroke_id': stroke['id'],
                        'stroke': json.dumps(stroke),
                    })
                    # Here we collect the strokes that have to be marked as deleted or restored
                    if stroke['action'] == 'deleteOne':
                        deleted_indexes = [
                            ('sketchpad_seq_id', '=', sketchpad_id),
                            ('local_stroke_id', '=', stroke['params']['localId']),
                            ('user_identifier', '=', stroke['params']['createdBy'])
                        ]
                    elif stroke['action'] == 'deleteMany':
                        undo_indexes = [
                            ('sketchpad_seq_id', '=', sketchpad_id),
                            ('local_stroke_id', '>=', stroke['params']['start']),
                            ('local_stroke_id', '<=', stroke['params']['end']),
                            ('user_identifier', '=', stroke['params']['createdBy'])
                        ]
                        # contains the shapes that were deleted, so we need to restore them if the user undoes the action
                        if 'restore' in stroke['params']:
                            restore_indexes = [
                                ('sketchpad_seq_id', '=', sketchpad_id),
                                ('local_stroke_id', '=', stroke['params']['restore']['localId']),
                                ('user_identifier', '=', stroke['params']['restore']['createdBy'])
                            ]
            self.env['knowledge_canvas.sketchpad_stroke_history'].create(strokes_to_add)
            if deleted_indexes:
                self.env['knowledge_canvas.sketchpad_stroke_history'].search(deleted_indexes).write({'deleted': True})
            if undo_indexes:
                # psycopg2 automatically sanitizes the input value, preventing SQL injection.
                self.env.cr.execute("""
                    UPDATE knowledge_canvas_sketchpad_stroke_history
                    SET deleted = NOT deleted
                    WHERE user_identifier = %s
                    AND local_stroke_id >= %s
                    AND local_stroke_id <= %s
                    AND sketchpad_seq_id = %s
                """, (undo_indexes[2][2], undo_indexes[0][2], undo_indexes[1][2], sketchpad_id)) # possibly use ORM to do this when it supports
            if restore_indexes:
                self.env['knowledge_canvas.sketchpad_stroke_history'].search(restore_indexes).write({'deleted': False})


class SketchpadStrokeHistory(models.Model):
    """ Model that stores data related to individual strokes and metadata for keeping track of the history """
    _name = 'knowledge_canvas.sketchpad_stroke_history'
    _description = 'Model that stores data related to individual strokes and metadata for keeping track of the history'
    _inherit = ['knowledge_canvas.collaborative_strokes.mixin']

    sketchpad_seq_id = fields.Many2one('knowledge_canvas.sketchpad', 'Sketchpad Sequence ID', ondelete='cascade', required=True)
    stroke = Json('Stroke History')
    deleted = fields.Boolean('Deleted', default=False)
    user_identifier = fields.Char('User Identifier', index=True)
    local_stroke_id = fields.Integer('Local Stroke ID', index=True)
