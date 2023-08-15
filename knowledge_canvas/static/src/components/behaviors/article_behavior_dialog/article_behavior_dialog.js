/** @odoo-module */

import { useService } from '@web/core/utils/hooks';
import { Dialog } from '@web/core/dialog/dialog';
import { Component, onMounted, useRef } from '@odoo/owl';

export class ArticleSelectionBehaviorDialog extends Component {
    /**
     * @override
     */
    setup() {
        super.setup();
        this.orm = useService('orm');
        this.input = useRef('input');
        onMounted(() => {
            this.initSelect2();
            // see "focus" method of select2 lib for details about setTimeout
            window.setTimeout(() => {
                this.getInput().select2('open');
                document.querySelector('.o_knowledge_select2 .select2-focusser').focus(); // auto-focus
            }, 0);
        });
    }

    /**
    * @returns {JQuery}
    */
    getInput() {
        return $(this.input.el);
    }

    onArticleSelected() {
        const $input = $(this.input.el);
        if (!$input.select2('data')){
            return;
        }
        const articleId = $input.select2('data').id;
        const displayName = $input.select2('data').display_name;

        this.props.articleSelected({articleId: articleId, displayName: displayName});
        this.props.close();
    }

    initSelect2() {
        const $input = this.getInput();
        $input.select2({
            containerCssClass: 'o_knowledge_select2',
            dropdownCssClass: 'o_knowledge_select2',
            ajax: {
                /**
                 * @param {String} term
                 * @returns {Object}
                 */
                data: term => {
                    return { term };
                },
                quietMillis: 500,
                /**
                 * @param {Object} params - parameters
                 */
                transport: async params => {
                    const { term } = params.data;
                    let domain = [['user_has_access', "=", true]];
                    if (term) {
                        domain.push(['name', '=ilike', `%${term}%`]);
                    }
                    const results = await this.orm.call(
                        'knowledge.article',
                        'search_read',
                        [],
                        {
                            fields: ['id', 'display_name', 'root_article_id'],
                            domain: domain,
                            limit: 50,
                        },
                    );
                    params.success({ results });
                },
                /**
                 * @param {Object} data
                 * @returns {Object}
                 */
                processResults: data => {
                    return {
                        results: data.results.map(record => {
                            return {
                                id: record.id,
                                display_name: record.display_name,
                                subject: record.root_article_id[1],
                            };
                        })
                    };
                },
            },
            /**
             * @param {Object} data
             * @param {JQuery} container
             * @param {Function} escapeMarkup
             */
            formatSelection: (data, container, escapeMarkup) => {
                return escapeMarkup(data.display_name);
            },
            /**
             * @param {Object} result
             * @param {JQuery} container
             * @param {Object} query
             * @param {Function} escapeMarkup
             */
            formatResult: (result, container, query, escapeMarkup) => {
                const { display_name, subject } = result;
                const markup = [];
                window.Select2.util.markMatch(display_name, query.term, markup, escapeMarkup);
                if (subject !== display_name) {
                    markup.push(`<span class="text-ellipsis small">  -  ${escapeMarkup(subject)}</span>`);
                }
                return markup.join('');
            },
        });
    }

}

ArticleSelectionBehaviorDialog.template = 'knowledge.wysiwyg_article_selection_modal';
ArticleSelectionBehaviorDialog.components = { Dialog };
ArticleSelectionBehaviorDialog.props = {
    articleSelected: Function,
    close: Function,
    confirmLabel: String,
    title: String,
};
