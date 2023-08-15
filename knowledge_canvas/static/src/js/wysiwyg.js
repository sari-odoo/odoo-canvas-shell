/** @odoo-module **/

import { Component } from '@odoo/owl';
import { qweb as QWeb, _t } from 'web.core';
import Wysiwyg from 'web_editor.wysiwyg';
import { PromptEmbeddedViewNameDialog } from '@knowledge_canvas/components/prompt_embedded_view_name_dialog/prompt_embedded_view_name_dialog';
import {
    preserveCursor,
    setCursorEnd,
} from '@web_editor/js/editor/odoo-editor/src/OdooEditor';
import { ArticleSelectionBehaviorDialog } from '@knowledge_canvas/components/behaviors/article_behavior_dialog/article_behavior_dialog';
import { Markup } from 'web.utils';
import {
    encodeDataBehaviorProps,
} from "@knowledge/js/knowledge_utils";

Wysiwyg.include({
    defaultOptions: {
        ...Wysiwyg.prototype.defaultOptions,
        allowCommandFile: true,
    },
    /**
     * @override
     */
    resetEditor: async function () {
        await this._super(...arguments);
        this.$editable[0].dispatchEvent(new Event('refresh_behaviors'));
    },
    /**
     * Check if the selection starts inside a table. This function can be used
     * as the `isDisabled` property of a command of the PowerBox to disable
     * a command in a table.
     * @returns {boolean} true if the command should be filtered
     */
    _filterCommandInTable: function () {
        let anchor = document.getSelection().anchorNode;
        if (anchor.nodeType !== Node.ELEMENT_NODE) {
            anchor = anchor.parentElement;
        }
        if (anchor && anchor.closest('table')) {
            return true;
        }
        return false;
    },
    /**
     * Check if the selection starts inside a Behavior element.
     * This function can be used as the `isDisabled` property of a command of
     * the PowerBox to disable a command in a template.
     * Example: The content of a /template block is destined to be used in
     * @see OdooEditor in modules other than Knowledge, where knowledge-specific
     * commands may not be available, so commands inserting a non-supported
     * Behavior in the /template content should be disabled.
     * @returns {boolean} true if the command should be filtered
     */
    _filterCommandInBehavior: function () {
        let anchor = document.getSelection().anchorNode;
        if (anchor.nodeType !== Node.ELEMENT_NODE) {
            anchor = anchor.parentElement;
        }
        if (anchor && anchor.closest('.o_knowledge_behavior_anchor')) {
            return true;
        }
        return false;
    },
    /**
     * @override
     */
    _getEditorOptions: function () {
        const finalOptions = this._super.apply(this, arguments);
        const onHistoryResetFromSteps = finalOptions.onHistoryResetFromSteps;
        finalOptions.onHistoryResetFromSteps = () => {
            onHistoryResetFromSteps();
            if (this._onHistoryResetFromSteps) {
                this._onHistoryResetFromSteps();
            }
        };
        return finalOptions;
    },
    /**
     * @override
     * @returns {Array[Object]}
     */
    _getPowerboxOptions: function () {
        const options = this._super();
        const {commands, categories} = options;
        categories.push({ name: _t('Media'), priority: 50 });
        commands.push({
            category: _t('Media'),
            name: _t('Article'),
            priority: 10,
            description: _t('Link an article'),
            fontawesome: 'fa-file',
            isDisabled: () => this.options.isWebsite || this.options.inIframe,
            callback: () => {
                this._insertArticleLink();
            },
        });

        if (this.options.knowledgeCommands) {
            categories.push(
                { name: _t('Knowledge'), priority: 11 },
                { name: _t('Knowledge Databases'), priority: 10 }
            );

            commands.push({
                category: _t('Knowledge'),
                name: _t('File'),
                priority: 20,
                description: _t('Upload a file'),
                fontawesome: 'fa-file',
                isDisabled: () => this._filterCommandInBehavior() || !this.options.allowCommandFile,
                callback: () => {
                    this.openMediaDialog({
                        noVideos: true,
                        noImages: true,
                        noIcons: true,
                        noDocuments: true,
                        knowledgeDocuments: true,
                    });
                }
            }, {
                category: _t('Knowledge'),
                name: _t('Table Of Content'),
                priority: 30,
                description: _t('Add a table of content'),
                fontawesome: 'fa-bookmark',
                isDisabled: () => this._filterCommandInBehavior() || this._filterCommandInTable(),
                callback: () => {
                    this._insertTableOfContent();
                },
            }, {
                category: _t('Knowledge Databases'),
                name: _t('Item Kanban'),
                priority: 40,
                description: _t('Insert a Kanban view of article items'),
                fontawesome: 'fa-th-large',
                isDisabled: () => this._filterCommandInBehavior() || this._filterCommandInTable(),
                callback: () => {
                    const restoreSelection = preserveCursor(this.odooEditor.document);
                    const viewType = 'kanban';
                    this._openEmbeddedViewDialog(viewType, async (name) => {
                        await this._rpc({
                            model: 'knowledge.article',
                            method: 'create_default_item_stages',
                            args: [[this.options.recordInfo.res_id]],
                        });
                        this._insertEmbeddedView('knowledge_canvas.knowledge_article_item_action_stages', viewType, name, restoreSelection, {
                            active_id: this.options.recordInfo.res_id,
                            default_parent_id: this.options.recordInfo.res_id,
                            default_is_article_item: true,
                        });
                    }, restoreSelection);
                }
            }, {
                category: _t('Knowledge'),
                name: _t('Item List'),
                priority: 50,
                description: _t('Insert a List view of article items'),
                fontawesome: 'fa-th-list',
                isDisabled: () => this._filterCommandInBehavior() || this._filterCommandInTable(),
                callback: () => {
                    const restoreSelection = preserveCursor(this.odooEditor.document);
                    const viewType = 'list';
                    this._openEmbeddedViewDialog(viewType, name => {
                        restoreSelection();
                        this._insertEmbeddedView('knowledge.knowledge_article_item_action', viewType, name, {
                            active_id: this.options.recordInfo.res_id,
                            default_parent_id: this.options.recordInfo.res_id,
                            default_icon: '📄',
                            default_is_article_item: true,
                        });
                    });
                }
            }, {
                category: _t('Knowledge'),
                name: _t('Index'),
                priority: 60,
                description: _t('Show the first level of nested articles.'),
                fontawesome: 'fa-list',
                isDisabled: () => this._filterCommandInBehavior() || this._filterCommandInTable(),
                callback: () => {
                    this._insertArticlesStructure(true);
                }
            }, {
                category: _t('Knowledge'),
                name: _t('Article Structure'),
                priority: 60,
                description: _t('Show all nested articles.'),
                fontawesome: 'fa-list',
                isDisabled: () => this._filterCommandInBehavior() || this._filterCommandInTable(),
                callback: () => {
                    this._insertArticlesStructure(false);
                }
            });
        }
        return {...options, commands, categories};
    },
    /**
     * Notify @see FieldHtmlInjector that behaviors need to be injected
     * @see KnowledgeBehavior
     *
     * @param {Element} anchor blueprint for the behavior to be inserted
     * @param {Function} restoreSelection Instructions on where to insert it
     * @param {Function} insert Instructions on how to insert it if it needs
     *                   custom handling
     */
    _notifyNewBehavior(anchor, restoreSelection, insert = null) {
        const type = Array.from(anchor.classList).find(className => className.startsWith('o_knowledge_behavior_type_'));
        this.$editable[0].dispatchEvent(new CustomEvent('refresh_behaviors', { detail: { behaviorData: {
            anchor,
            behaviorType: type,
            setCursor: true,
            restoreSelection,
            behaviorStatus: 'new',
            insert,
        }}}));
    },
    /**
     * Insert a /toc block (table of content)
     */
    _insertTableOfContent: function () {
        const restoreSelection = preserveCursor(this.odooEditor.document);
        const tableOfContentBlock = $(QWeb.render('knowledge.abstract_behavior', {
            behaviorType: "o_knowledge_behavior_type_toc",
        }))[0];
        this._notifyNewBehavior(tableOfContentBlock, restoreSelection);
    },
    /**
     * Insert a /structure block.
     * It will list all the articles that are direct children of this one.
     * @param {boolean} childrenOnly
     */
    _insertArticlesStructure: function () {
        const restoreSelection = preserveCursor(this.odooEditor.document);
        const articlesStructureBlock = $(QWeb.render('knowledge.articles_structure_wrapper'))[0];
        this._notifyNewBehavior(articlesStructureBlock, restoreSelection);
    },
    /**
     * Insert a /article block (through a dialog)
     */
    _insertArticleLink: function () {
        const restoreSelection = preserveCursor(this.odooEditor.document);
        Component.env.services.dialog.add(ArticleSelectionBehaviorDialog, {
            title: _t('Link an Article'),
            confirmLabel: _t('Insert Link'),
            articleSelected: article => {
                const articleLinkBlock = $(QWeb.render('knowledge.wysiwyg_article_link', {
                    href: '/knowledge/article/' + article.articleId,
                    data: JSON.stringify({
                        article_id: article.articleId,
                        display_name: article.displayName,
                    })
                }))[0];
                const nameNode = document.createTextNode(article.display_name);
                articleLinkBlock.appendChild(nameNode);
                this._notifyNewBehavior(articleLinkBlock, restoreSelection);
            }
        });
    },
    /**
     * Inserts a view in the editor
     * @param {String} actWindowId - Act window id of the action
     * @param {String} viewType - View type
     * @param {String} name - Name
     * @param {Function} restoreSelection - function to restore the selection
     *                   to insert the embedded view where the user typed the
     *                   command.
     * @param {Object} context - Context
     * @param {Object} additionalProps - props to pass to the view when loading
     *                 it.
     */
    _insertEmbeddedView: async function (actWindowId, viewType, name, restoreSelection, context={}, additionalViewProps={}) {
        context.knowledge_embedded_view_framework = 'owl';
        const embeddedViewBlock = $(await this._rpc({
            model: 'knowledge.article',
            method: 'render_embedded_view',
            args: [[this.options.recordInfo.res_id], actWindowId, viewType, name, context],
        }))[0];
        this._notifyNewBehavior(embeddedViewBlock, restoreSelection);
    },
    /**
     * Insert a behaviorBlueprint programatically. If the wysiwyg is a part of a
     * collaborative peer to peer connection, ensure that the behaviorBlueprint
     * is properly appended even when the content is reset by the collaboration.
     *
     * @param {HTMLElement} behaviorBlueprint element to append to the editable
     */
    appendBehaviorBlueprint(behaviorBlueprint) {
        const restoreSelection = () => {
            // Set the cursor to the end of the article by not normalizing the position.
            // By not normalizing we ensure that we will use the articleś body as the container
            // and not an invisible character.
            setCursorEnd(this.odooEditor.editable, false);
        }
        const insert = (anchor) => {
            const fragment = this.odooEditor.document.createDocumentFragment();
            // Add a P after the Behavior to be able to continue typing
            // after it
            const p = this.odooEditor.document.createElement('p');
            p.append(this.odooEditor.document.createElement('br'));
            fragment.append(anchor, p);
            const [behavior] = this.odooEditor.execCommand('insert', fragment);
            behavior.scrollIntoView();
        };
        // Clone behaviorBlueprint to be sure that the nodes are not modified
        // during the first insertion attempt and that the correct nodes
        // are inserted the second time.
        this._notifyNewBehavior(behaviorBlueprint.cloneNode(true), restoreSelection, (anchor) => {
            insert(anchor);
            this._onHistoryResetFromSteps = () => {
                this._notifyNewBehavior(behaviorBlueprint.cloneNode(true), restoreSelection, insert);
                this._onHistoryResetFromSteps = undefined;
            };
        });
    },
    /**
     * Notify the @see FieldHtmlInjector when a /file block is inserted from a
     * @see MediaDialog
     *
     * @private
     * @override
     */
    _onMediaDialogSave(params, element) {
        if (element.classList.contains('o_is_knowledge_file')) {
            element.classList.remove('o_is_knowledge_file');
            element.classList.add('o_image');
            const extension = (element.title && element.title.split('.').pop()) || element.dataset.mimetype;
            const fileBlock = $(QWeb.render('knowledge.WysiwygFileBehavior', {
                behaviorType: "o_knowledge_behavior_type_file",
                fileName: element.title,
                fileImage: Markup(element.outerHTML),
                behaviorProps: encodeDataBehaviorProps({
                    fileName: element.title,
                    fileExtension: extension,
                }),
                fileExtension: extension,
            }))[0];
            this._notifyNewBehavior(fileBlock, params.restoreSelection);
            // need to set cursor (anchor.sibling)
        } else {
            return this._super(...arguments);
        }
    },
    /**
     * Inserts the dialog allowing the user to specify name for the embedded view.
     * @param {String} viewType
     * @param {Function} save
     */
    _openEmbeddedViewDialog: function (viewType, save, onClose) {
        Component.env.services.dialog.add(PromptEmbeddedViewNameDialog, {
            isNew: true,
            viewType: viewType,
            save: save
        }, {
            onClose: onClose || (() => {}),
        });
    },
});
