import json

from markupsafe import Markup
from urllib import parse

from odoo import api, models, fields, _
from odoo.exceptions import ValidationError

ARTICLE_PERMISSION_LEVEL = {'none': 0, 'read': 1, 'write': 2}


class Article(models.Model):
    _inherit = ['knowledge.article']

    sketchpad_ids = fields.One2many('knowledge_canvas.sketchpad', 'article_id', 'Sketchpads', required=True)

    # ------------------------------------------------------------
    # HELPERS
    # ------------------------------------------------------------

    @api.model
    @api.returns('knowledge.article', lambda article: article.id)
    def article_create(self, title=False, parent_id=False, is_private=False, is_article_item=False, article_properties=False):
        """ Helper to create articles, allowing to pre-compute some configuration
        values.

        :param str title: name of the article;
        :param int parent_id: id of an existing article who will be the parent
          of the newly created articled. Must be writable;
        :param bool is_private: set current user as sole owner of the new article;
        :param bool is_article_item: set the created article as an article item;
        """
        parent = self.browse(parent_id) if parent_id else self.env['knowledge.article']
        values = {
            'is_article_item': is_article_item,
            'parent_id': parent.id
        }
        if title:
            values['name'] = title

        if parent:
            if not is_private and parent.category == "private":
                is_private = True
        else:
            # child do not have to setup an internal permission as it is inherited
            values['internal_permission'] = 'none' if is_private else 'write'
            # For private articles, we need to set a member because the internal_permission is set to
            # 'none' which restricts the access to only members of the article.

            # For workspace articles, we need to add a member because the visibility of a brand new root
            # article is always set to 'Members', meaning that only the members are able to see it at all times in
            # their tree.
            # And we need the creator to be able to see it in order for him to easily edit it later.
            values['article_member_ids'] = [(0, 0, {
                'partner_id': self.env.user.partner_id.id,
                'permission': 'write',
            })]

        if is_private:
            if parent and parent.category != "private":
                raise ValidationError(
                    _("Cannot create an article under article %(parent_name)s which is a non-private parent",
                      parent_name=parent.display_name)
                )

        if is_article_item and article_properties:
            values['article_properties'] = article_properties

        return self.create(values)

    # ------------------------------------------------------------
    # BUSINESS METHODS
    # ------------------------------------------------------------

    def create_default_item_stages(self):
        """ Need to create stages if this article has no stage yet. """
        stage_count = self.env['knowledge.article.stage'].search_count(
            [('parent_id', '=', self.id)])
        if not stage_count:
            self.env['knowledge.article.stage'].create([{
                "name": stage_name,
                "sequence": sequence,
                "parent_id": self.id,
                "fold": fold
            } for stage_name, sequence, fold in [
                (_("New"), 0, False), (_("Ongoing"), 1, False), (_("Done"), 2, True)]
            ])

    def render_embedded_view_link(self, act_window_id_or_xml_id, view_type, name, view_context):
        """
        Returns the HTML tag that will be recognized by the editor as a
        view link. This tag will contain all data needed to open the given view.
        :param int | str act_window_id_or_xml_id: id or xml id of the action
        :param str view_type: type of the view ('kanban', 'list', ...)
        :param str name: display name
        :param dict view_context: context of the view

        :return: rendered template for the view link
        """
        self.ensure_one()
        action_data = self._extract_act_window_data(act_window_id_or_xml_id, name)
        action_data.pop('help', None)
        return self.env['ir.qweb']._render(
            'knowledge.knowledge_view_link', {
                'behavior_props': parse.quote(json.dumps({
                    'act_window': action_data,
                    'context': view_context or {},
                    'name': name,
                    'view_type': view_type,
                }), safe='()*!\'')
            },
            minimal_qcontext=True,
            raise_if_not_found=False
        )

    def render_embedded_view(self, act_window_id_or_xml_id, view_type, name, view_context, additional_view_props=False):
        """
        Returns the HTML tag that will be recognized by the editor as an embedded view.
        :param int | str act_window_id_or_xml_id: id or xml id of the action
        :param str view_type: type of the view ('kanban', 'list', ...)
        :param str name: display name
        :param dict view_context: context of the view
        :param dict additional_props: additional props to use when rendering the view,
            typically used to store start/end date property fields for the item calendar

        :return: rendered template for embedded views
        """
        self.ensure_one()
        action_data = self._extract_act_window_data(act_window_id_or_xml_id, name)
        action_help = action_data.pop('help', None)
        behavior_props = {
            'act_window': action_data,
            'context': view_context or {},
            'view_type': view_type,
        }

        if additional_view_props:
            behavior_props['additionalViewProps'] = additional_view_props

        return self.env['ir.qweb']._render(
            'knowledge.knowledge_embedded_view', {
                'behavior_props': parse.quote(json.dumps(behavior_props), safe='()*!\''),
                'action_help': Markup(action_help) if action_help else False,
            },
            minimal_qcontext=True,
            raise_if_not_found=False
        )

    @api.model
    def get_empty_list_help(self, help_message):
        # Meant to target knowledge_article_action_trashed action only.
        # -> Use the specific context key of that action to target it.
        if not "search_default_filter_trashed" in self.env.context:
            return super().get_empty_list_help(help_message)
        get_param = self.env['ir.config_parameter'].sudo().get_param
        limit_days = get_param('knowledge.knowledge_article_trash_limit_days')
        try:
            limit_days = int(limit_days)
        except ValueError:
            limit_days = self.DEFAULT_ARTICLE_TRASH_LIMIT_DAYS
        title = _("No Article in Trash")
        description = Markup(
            _("""Deleted articles are stored in Trash an extra <b>%(threshold)s</b> days
                 before being permanently removed for your database""")) % {"threshold": limit_days}

        return super().get_empty_list_help(
            f'<p class="o_view_nocontent_smiling_face">{title}</p><p>{description}</p>'
        )

    def get_visible_articles(self, root_articles_ids, unfolded_ids):
        """ Get the articles that are visible in the sidebar with the given
        root articles and unfolded ids.

        An article is visible if it is a root article, or if it is a child
        article (not item) of an unfolded visible article.
        """
        if root_articles_ids:
            visible_articles_domain = [
            '|',
                ('id', 'in', root_articles_ids),
                '&',
                    '&',
                        ('parent_id', 'in', unfolded_ids),
                        ('id', 'child_of', root_articles_ids),  # Don't fetch hidden unfolded
                    ('is_article_item', '=', False)
            ]

            return self.env['knowledge.article'].search(
                visible_articles_domain,
                order='sequence, id',
            )
        return self.env['knowledge.article']

    def get_sidebar_articles(self, unfolded_ids=False):
        """ Get the data used by the sidebar on load in the form view.
        It returns some information from every article that is accessible by
        the user and that is either:
            - a visible root article
            - a favorite article or a favorite item (for the current user)
            - the current article (except if it is a descendant of a hidden
              root article or of an non accessible article - but even if it is
              a hidden root article)
            - an ancestor of the current article, if the current article is
              shown
            - a child article of any unfolded article that is shown
        """

        # Fetch root article_ids as sudo, ACLs will be checked on next global call fetching 'all_visible_articles'
        # this helps avoiding 2 queries done for ACLs (and redundant with the global fetch)
        root_articles_ids = self.env['knowledge.article'].sudo().search(
            [("parent_id", "=", False), ("is_article_visible", "=", True)]
        ).ids
        favorite_articles_ids = self.env['knowledge.article.favorite'].sudo().search(
            [("user_id", "=", self.env.user.id), ('is_article_active', '=', True)]
        ).article_id.ids

        # Add favorite articles and items (they are root articles in the
        # favorite tree)
        root_articles_ids += favorite_articles_ids

        if unfolded_ids is False:
            unfolded_ids = []

        # Add active article and its parents in list of unfolded articles
        if self.is_article_visible:
            if self.parent_id:
                unfolded_ids += self._get_ancestor_ids()
        # If the current article is a hidden root article, show the article
        elif not self.parent_id and self.id:
            root_articles_ids += [self.id]

        all_visible_articles = self.get_visible_articles(root_articles_ids, unfolded_ids)

        return {
            "articles": all_visible_articles.read(
                ['name', 'icon', 'parent_id', 'category', 'is_locked', 'user_can_write', 'is_user_favorite', 'is_article_item', 'has_article_children'],
                None,  # To not fetch the name of parent_id
            ),
            "favorite_ids": favorite_articles_ids,
        }
