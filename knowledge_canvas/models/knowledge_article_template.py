# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

from lxml import html
from urllib import parse
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
from odoo.tools.translate import html_translate


class ArticleTemplate(models.Model):
    """This model stores and renders article templates."""

    _name = "knowledge.article.template"
    _description = "Article Template"
    _order = "category_sequence ASC, sequence ASC, id ASC"

    template_properties = fields.Properties("Property fields", definition="parent_id.template_properties_definition",
        compute="_compute_template_properties", readonly=False, store=True)
    template_properties_definition = fields.PropertiesDefinition("Article Item Properties")
    body = fields.Html(string="Body", translate=html_translate)
    category_id = fields.Many2one("knowledge.article.template.category", string="Category",
        compute="_compute_category_id", inverse="_inverse_category_id", required=True, store=True)
    category_sequence = fields.Integer(string="Category Sequence", related="category_id.sequence", store=True)
    child_ids = fields.One2many(
        "knowledge.article.template", "parent_id", string="Child Templates", copy=True)
    cover_image_id = fields.Many2one("knowledge.cover", string="Article cover")
    cover_image_url = fields.Char(related="cover_image_id.attachment_url", string="Cover url")
    description = fields.Char(string="Description", translate=True, help="Description of the template")
    icon = fields.Char(string="Emoji")
    is_template_item = fields.Boolean(string="Is Item?", compute="_compute_is_template_item", readonly=False, store=True)
    name = fields.Char(string="Title", translate=True, required=True)
    parent_id = fields.Many2one(
        "knowledge.article.template", string="Parent Template", ondelete="cascade")
    sequence = fields.Integer(string="Template Sequence", help="It determines the display order of the template within its category")

    _sql_constraints = [
        ("check_template_item_parent",
         "check(is_template_item IS NOT TRUE OR parent_id IS NOT NULL)",
         "Template considered as article item must have a parent."
         ),
        ("check_category_on_root",
         "check(parent_id IS NOT NULL OR category_id IS NOT NULL)",
         "Root templates must have a category."
         ),
    ]

    @api.depends('icon')
    def _compute_display_name(self):
        no_icon_placeholder = self.env['knowledge.article']._get_no_icon_placeholder()
        for rec in self:
            rec.display_name = f"{rec.icon or no_icon_placeholder} {rec.name}"

    @api.constrains("parent_id")
    def _check_parent_id_recursion(self):
        if not self._check_recursion():
            raise ValidationError(
                _("Templates %s cannot be updated as this would create a recursive hierarchy.",
                  ", ".join(self.mapped("name"))
                 )
            )

    def _load_records_create(self, vals_list):
        """
        When loading a record from the data XML files, we will properly encode
        the attributes of the HTML tags that will be recognised by the editor as
        embedded views. This function makes the templates easily readable and
        editable from the XML files.
        """
        for vals in vals_list:
            if vals.get("body"):
                vals["body"] = self._post_process_template_body(vals["body"])
        return super()._load_records_create(vals_list)

    def _load_records_write(self, vals):
        """
        When updating a record, we will also encode the attributes of the HTML
        tags that will be recognise by the editor as embedded views.
        """
        if vals.get("body"):
            vals["body"] = self._post_process_template_body(vals["body"])
        return super()._load_records_write(vals)

    def _post_process_template_body(self, body):
        fragment = html.fragment_fromstring(body, create_parent=True)
        for element in fragment.findall(".//*[@data-behavior-props]"):
            if 'o_knowledge_behavior_type_embedded_view' in element.get("class"):
                element.set("data-behavior-props", parse.quote(element.get("data-behavior-props"), safe='()*!\''))
        return html.tostring(fragment)

    # Compute methods:

    @api.depends("parent_id")
    def _compute_category_id(self):
        self._propagate_category_id()

    def _inverse_category_id(self):
        self._propagate_category_id()

    def _propagate_category_id(self):
        """ The templates inherit the category for their parents. This method will
            ensure that the categories will be consistent over the whole template
            hierarchy. To update the category of a template, the user will have to
            update the category of the root template. """
        for template in self:
            if template.parent_id:
                template.category_id = template.parent_id.category_id
            for child in template.child_ids:
                child.category_id = template.category_id

    @api.depends("parent_id")
    def _compute_is_template_item(self):
        for template in self:
            if not template.parent_id:
                template.is_template_item = False

    @api.depends("parent_id")
    def _compute_template_properties(self):
        for template in self:
            if not template.parent_id:
                template.template_properties = {}

    # Public methods:

    def apply_template_on_article(self, article_id):
        """
        Applies the current template on the given article
        :param int article_id: Article id
        """
        self.ensure_one()
        article = self.env["knowledge.article"].browse(article_id)
        article.ensure_one()

        article.write({
            "article_properties": self.template_properties or {},
            "article_properties_definition": self.template_properties_definition,
            "body": self.body,
            "cover_image_id": self.cover_image_id.id,
            "icon": self.icon,
            "name": article.name or self.name
        })

        stack = [(article, self)]
        while stack:
            (parent_article, parent_template) = stack.pop()
            if not parent_template.child_ids:
                continue
            articles = self.env["knowledge.article"].create([{
                "article_properties": template.template_properties or {},
                "article_properties_definition": template.template_properties_definition,
                "body": template.body,
                "cover_image_id": template.cover_image_id.id,
                "icon": template.icon,
                "is_article_item": template.is_template_item,
                "name": template.name,
                "parent_id": parent_article.id,
            } for template in parent_template.child_ids])
            stack.extend(zip(articles, parent_template.child_ids))

    def create_article(self):
        self.ensure_one()
        article = self.env["knowledge.article"].article_create(is_private=True)
        self.apply_template_on_article(article.id)
        return article.id
