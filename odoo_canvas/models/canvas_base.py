from odoo import api, _, models, fields
from odoo.exceptions import UserError

class OdooCanvas(models.Model):
    _name = 'odoo.canvas'
    _description = 'Collaborative sketch pad and data-mapping tool'

    name = fields.Char(string='Canvas Name', required=True)
    author = fields.Many2one('res.users', string='Author', default=lambda self: self.env.user)
    date_created = fields.Datetime(string='Date Created', default=fields.Datetime.now)
    last_modified = fields.Datetime(string='Last Modified')
    content = fields.Char()

    # This is the canvas ID, which will be a string of the for cnv-<intid>
    canvas_id = fields.Char(string='Canvas ID')

    @api.model
    def create(self, vals):
        total_canvases = self.search_count([]) or 0
        vals['canvas_id'] = "cnv-%s" % (total_canvases + 1)
        return super(OdooCanvas, self).create(vals)
    

    # The compute function for the canvas_id
    # Initial attempt - decided to override create instead
    # def _compute_canvas_id(self):
    #     for rec in self:
    #         canvas_count = self.search_count([]) or 0
    #         rec.canvas_id = "cnv-%s" % (canvas_count + 1)

    # Call this method upon modification of the current Canvas.
    # This will have to be configured later, but for now, it will
    # be called upon the creation of a new Canvas.
    def write(self, vals):
        vals['last_modified'] = fields.Datetime.now()
        return super(OdooCanvas, self).write(vals)
    
    # This will be the action that will go to the Canvas view that we will define in OWL
    # @vyas check this out.
    def go_to_canvas(self):
        if not self.canvas_id:
            raise UserError(_('Please save the canvas before testing.'))
        url = "/canvas/%s" % self.canvas_id
        return {
            'type': 'ir.actions.act_url',
            'url': url,
            'target': 'self',
        }


class CanvasObjectWizard(models.TransientModel):
    _name = 'odoo_canvas.object.wizard'
    _description = 'Canvas Object Wizard'

    name = fields.Char(string='Object Name', index=True)
    content_image = fields.Binary(string='Image Content')
    content_text = fields.Text(string='Text Content')
    content_type = fields.Selection(selection=[
        ('image/png', 'PNG'),
        ('image/jpeg', 'JPEG'),
        ('text', 'Text'),
        ('mind_map', 'Mind Map'),
    ], default='text', index=True)
    pos_x = fields.Float(string='X Position')
    pos_y = fields.Float(string='Y Position')
    # dimensions = fields.Float(string='Dimensions', digits=(6, 2))
    parent_id = fields.Many2one('odoo_canvas.object', string='Parent Object')

    def create_canvas_object(self):
        if self.content_type in ['image/jpeg','image/png']:
            self.env['odoo_canvas.object'].create({
                'name': self.name,
                'parent_id': self.parent_id.element_id,
                'content_image': self.content_image,
                'content_text': False,
                'content_type': self.content_type,
                'pos_x': self.pos_x,
                'pos_y': self.pos_y,
                # 'dimensions': self.dimensions,
            })
        else: # text or mind_map
            self.env['odoo_canvas.object'].create({
                'name': self.name,
                'parent_id': self.parent_id.element_id,
                'content_image': False,
                'content_text': self.content_text,
                'content_type': self.content_type,
                'pos_x': self.pos_x,
                'pos_y': self.pos_y,
                # 'dimensions': self.dimensions,
            })
        return {'type': 'ir.actions.act_window_close'}
