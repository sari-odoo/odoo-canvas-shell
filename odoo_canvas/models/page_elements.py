from odoo import models, fields, api

class PageElements(models.Model):
    _name = "odoo_canvas.object"
    _description = "Object for elements in each page"

    element_id = fields.Char(required=True, string="Element ID", 
        default='CO0000', copy=False, readonly=True)
    name = fields.Char("Object Name")
    parent_id = fields.Many2one(string="Parent", comodel_name="odoo_canvas.object")
    child_id = fields.One2many('odoo_canvas.object', 'parent_id')

    linked_elements = fields.Many2many("odoo_canvas.object", 'odoo_canvas_object_link_rel', 'object_id', 'link_id')

    pos_x = fields.Float('x-coordinate')
    pos_y = fields.Float('y-coordinate')
    pos_z = fields.Float('z-coordinate')

    dim_x = fields.Float('dimension-x')
    dim_y = fields.Float('dimension-y')

    content = fields.Binary()
    content_type = fields.Selection(selection=[
        ('image/png', 'PNG'),
        ('image/jpeg', 'JPEG'),
        ('text', 'Text'),
        ('mind_map', 'Mind Map'),
    ], default='text', index=True, string = 'Content Type')

    content_image = fields.Binary(string='Image Content')
    content_text = fields.Text(string='Text Content')

    @api.model_create_multi
    def create(self,vals_list):
        for vals in vals_list:
            vals['element_id'] = self.env['ir.sequence'].next_by_code('element.id')
        return super().create(vals_list)

    def action_open_new_canvas_wizard(self):
        return {
            'name': ('New Canvas Object'),
            'view_mode': 'form',
            'res_model': 'odoo_canvas.object.wizard',
            'type': 'ir.actions.act_window',
            # set default values here or allow the wizard to handle it
            'context': {},
            'target': 'new', 
        }