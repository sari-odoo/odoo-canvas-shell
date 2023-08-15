import uuid

from odoo import api, models, fields

class Sketchpad(models.Model):
    _name = 'knowledge_canvas.sketchpad'
    _description = 'Model that stores data related to strokes, users and history of the sketchpad'

    article_id = fields.Many2one('knowledge.article', 'Article', ondelete='cascade', required=True)
    sketchpad_seq_id = fields.Char('Sketchpad Sequence ID', required=True, readonly=True, copy=False, index=True)
    snapshot = fields.Char('Snapshot')  # stores a base64 encoded image of the canvas
    # stroke_history = Json('Stroke History')
    public_id = fields.Char('Public ID', compute='_compute_index', index=True)  # used to compute the public url of the sketchpad

    @api.model_create_multi
    def create(self,vals_list):
        for vals in vals_list:
            if not vals.get('sketchpad_seq_id'):
                vals['sketchpad_seq_id'] = self.env['ir.sequence'].next_by_code('knowledge_canvas.sketchpad_id')
        return super().create(vals_list)

    # used to compute the public url of the sketchpad
    def _compute_index(self):
        for line in self:
            line.index = uuid.uuid4()
