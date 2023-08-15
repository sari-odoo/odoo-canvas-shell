from odoo import api, models, fields

import datetime

class PageRevision(models.Model):
    _name = "page.revision"
    _description = "Collaborative Canvas Page revision"

    active = fields.Boolean(default=True)
    res_model = fields.Char(string="Model", required=True)
    res_id = fields.Many2oneReference(string="Record id", model_field='res_model', required=True)
    commands = fields.Char(required=True)
    revision_id = fields.Char(required=True)
    parent_revision_id = fields.Char(required=True)
    _sql_constraints = [
        ('parent_revision_unique', 'unique(parent_revision_id, res_id, res_model)', 'page revision refused due to concurrency')
    ]

    @api.autovacuum
    def _gc_revisions(self):
        # days = int(self.env["ir.config_parameter"].sudo().get_param(
        #     "spreadsheet_edition.revisions_limit_days",
        #     '60',
        # ))
        timeout_ago = datetime.datetime.utcnow()-datetime.timedelta(days=60)
        domain = [("create_date", "<", timeout_ago), ("active", "=", False)]
        return self.search(domain).unlink()