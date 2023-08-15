/** @odoo-module */

import { _t, qweb as QWeb } from "web.core";
import { getWysiwygClass } from "web_editor.loader";
import { HtmlField } from "@web_editor/js/backend/html_field";
import { onWillUpdateProps } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";


/**
 * This component will extend the HTML field of Knowledge and show an helper
 * when the article is empty. The helper will suggest the user to:
 * - Load a Template
 * - Build an Item Kanban
 * - Build an Item List
 * - Build an Item Calendar
 */
export class KnowledgeArticleHtmlField extends HtmlField {
    static template = "knowledge.KnowledgeArticleHtmlField";

    /**
     * @override
     */
    setup() {
        super.setup();
        this.actionService = useService("action");
        this.dialogService = useService("dialog");
        this.orm = useService("orm");
        onWillUpdateProps(nextProps => {
            this.state.isWysiwygHelperActive = this.isWysiwygHelperActive(nextProps);
        });
    }

    /**
     * @override
     */
    async _getWysiwygClass() {
        return getWysiwygClass({
            moduleName: "knowledge.wysiwyg"
        });
    }

    /**
     * @override
     * @param {Widget} wysiwyg
     */
    async startWysiwyg(wysiwyg) {
        await super.startWysiwyg(wysiwyg);
        Object.assign(this.state, {
            isEmpty: this.wysiwyg.isEmpty(),
            isWysiwygHelperActive: this.isWysiwygHelperActive(this.props)
        });
        this.wysiwyg.odooEditor.addEventListener("historyStep", () => {
            this.state.isEmpty = this.wysiwyg.isEmpty();
        });
    }

    /**
     * @param {Object} props
     * @returns {boolean}
     */
    isWysiwygHelperActive(props) {
        return !props.readonly && !props.record.data.is_article_item;
    }

    // onLoadTemplateBtnClick() {
    //     this.dialogService.add(ArticleTemplatePickerDialog, {
    //         onLoadTemplate: async articleTemplateId => {
    //             this.props.record.switchMode("readonly");
    //             if (this.props.record.isDirty) {
    //                 await this.props.record.save();
    //             }
    //             await this.orm.call("knowledge.article.template", "apply_template_on_article", [articleTemplateId], {
    //                 article_id: this.props.record.resId
    //             });
    //             await this.actionService.doAction("knowledge.ir_actions_server_knowledge_home_page", {
    //                 stackPosition: "replaceCurrentAction",
    //                 additionalContext: {
    //                     res_id: this.props.record.resId
    //                 }
    //             });
    //         }
    //     });
    // }

    // onBuildItemCalendarBtnClick() {
    //     this.dialogService.add(ItemCalendarPropsDialog, {
    //         isNew: true,
    //         knowledgeArticleId: this.props.record.resId,
    //         saveItemCalendarProps: async (name, itemCalendarProps) => {
    //             const title = name ? sprintf(_t("Calendar of %s"), name) : _t("Calendar of Article Items");
    //             const behaviorProps = {
    //                 action_xml_id: "knowledge.knowledge_article_action_item_calendar",
    //                 display_name: title,
    //                 view_type: "calendar",
    //                 context: {
    //                     active_id: this.props.record.resId,
    //                     default_parent_id: this.props.record.resId,
    //                     default_is_article_item: true,
    //                 },
    //                 additionalViewProps: { itemCalendarProps },
    //             };
    //             const body = QWeb.render("knowledge.article_item_template", {
    //                 behaviorProps: encodeDataBehaviorProps(behaviorProps),
    //                 title: name
    //             });
    //             this.updateArticle(name, body, {
    //                 full_width: true
    //             });
    //         }
    //     });
    // }

    // onBuildItemKanbanBtnClick() {
    //     this.dialogService.add(PromptEmbeddedViewNameDialog, {
    //         isNew: true,
    //         viewType: "kanban",
    //         /**
    //          * @param {string} name
    //          */
    //         save: async name => {
    //             const title = name ? sprintf(_t("Kanban of %s"), name) : _t("Kanban of Article Items");
    //             const behaviorProps = {
    //                 action_xml_id: "knowledge.knowledge_article_item_action_stages",
    //                 display_name: title,
    //                 view_type: "kanban",
    //                 context: {
    //                     active_id: this.props.record.resId,
    //                     default_parent_id: this.props.record.resId,
    //                     default_is_article_item: true,
    //                 }
    //             };
    //             const body = QWeb.render("knowledge.article_item_template", {
    //                 behaviorProps: encodeDataBehaviorProps(behaviorProps),
    //                 title
    //             });
    //             await this.orm.call("knowledge.article", "create_default_item_stages", [this.props.record.resId]);
    //             this.updateArticle(title, body, {
    //                 full_width: true
    //             });
    //         }
    //     });
    // }

    // onBuildItemListBtnClick() {
    //     this.dialogService.add(PromptEmbeddedViewNameDialog, {
    //         isNew: true,
    //         viewType: "list",
    //         /**
    //          * @param {string} name
    //          */
    //         save: async name => {
    //             const title = name ? sprintf(_t("List of %s"), name) : _t("List of Article Items");
    //             const behaviorProps = {
    //                 action_xml_id: "knowledge.knowledge_article_item_action",
    //                 display_name: title,
    //                 view_type: "list",
    //                 context: {
    //                     active_id: this.props.record.resId,
    //                     default_parent_id: this.props.record.resId,
    //                     default_is_article_item: true,
    //                 }
    //             };
    //             const body = QWeb.render("knowledge.article_item_template", {
    //                 behaviorProps: encodeDataBehaviorProps(behaviorProps),
    //                 title
    //             });
    //             this.updateArticle(title, body, {
    //                 full_width: true
    //             });
    //         }
    //     });
    // }

    /**
     * @param {string} title
     * @param {string} body
     * @param {Object} values
     */
    async updateArticle(title, body, values) {
        this.wysiwyg.setValue(body);
        if (!this.props.record.data.name) {
            await this.env.renameArticle(title);
        }
        await this.props.record.update(values);
    }
}

// export const knowledgeArticleHtmlField = Object.assign(Object.create(htmlField), {
//     component: KnowledgeArticleHtmlField,
// });

registry.category("fields").add("knowledge_article_html_field", KnowledgeArticleHtmlField);
