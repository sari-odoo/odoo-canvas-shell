/** @odoo-module */

import { _t } from "web.core";
import { AbstractBehavior } from "@knowledge_canvas/components/behaviors/abstract_behavior/abstract_behavior";
import { browser } from "@web/core/browser/browser";
import { SendAsMessageMacro, UseAsDescriptionMacro } from "@knowledge/macros/template_macros";
import { Tooltip } from "@web/core/tooltip/tooltip";
import { useService } from "@web/core/utils/hooks";
import { setCursorStart } from "@web_editor/js/editor/odoo-editor/src/utils/utils";
import {
    useRef,
    markup,
    onMounted,
    onWillUnmount,
} from "@odoo/owl";
import {
    BehaviorToolbar,
    BehaviorToolbarButton,
} from "@knowledge_canvas/components/behaviors/behavior_toolbar/behavior_toolbar";
import { sprintf } from '@web/core/utils/strings';

export class TemplateBehavior extends AbstractBehavior {
    static components = {
        BehaviorToolbar,
        BehaviorToolbarButton,
    };
    static props = {
        ...AbstractBehavior.props,
        content: { type: Object, optional: true },
    };
    static template = "knowledge.TemplateBehavior";

    setup() {
        super.setup();
        this.dialogService = useService("dialog");
        this.popoverService = useService("popover");
        this.uiService = useService("ui");
        this.copyToClipboardButton = useRef("copyToClipboardButton");
        this.templateContent = useRef("templateContent");
        this.content = this.props.content || markup('<p><br/></p>');
        onMounted(() => {
            this.copyToClipboardButton = this.props.anchor.querySelector("[name='copyToClipboard']");
            // Using ClipboardJS because ClipboardItem constructor is not
            // accepted by odoo eslint yet. In the future, it would be better
            // to use the CopyButton component (calling the native clipboard API).
            this.clipboard = new ClipboardJS(
                this.copyToClipboardButton,
                {target: () => this.templateContent.el}
            );
            this.clipboard.on('success', () => {
                window.getSelection().removeAllRanges();
                this.showTooltip();
            });
        });
        onWillUnmount(() => {
            if (this.clipboard) {
                this.clipboard.destroy();
            }
        });
        this.targetRecordInfo = this.knowledgeCommandsService.getCommandsRecordInfo();
        this.htmlFieldTargetMessage = sprintf(this.env._t('Use as %s'), this.targetRecordInfo?.fieldInfo?.string || 'Description');
    }
    /**
     * Set the cursor of the user inside the template block when the user types
     * the `/template` command.
     */
    setCursor() {
        setCursorStart(this.props.anchor.querySelector('[data-prop-name="content"] > p'));
    }
    showTooltip() {
        const closeTooltip = this.popoverService.add(this.copyToClipboardButton, Tooltip, {
            tooltip: _t("Content copied to clipboard."),
        });
        browser.setTimeout(() => {
            closeTooltip();
        }, 800);
    }
    /**
     * @param {Event} ev
     */
    onClickCopyToClipboard(ev) {
        ev.stopPropagation();
        ev.preventDefault();
    }
    /**
     * Callback function called when the user clicks on the "Use As ..." button.
     * The function executes a macro that opens the latest form view containing
     * a valid target field (see `KNOWLEDGE_RECORDED_FIELD_NAMES`) and copy/past
     * the content of the template to it.
     * @param {Event} ev
     */
    onClickUseAsDescription(ev) {
        const dataTransfer = this._createHtmlDataTransfer();
        const macro = new UseAsDescriptionMacro({
            targetXmlDoc: this.targetRecordInfo.xmlDoc,
            breadcrumbs: this.targetRecordInfo.breadcrumbs,
            data: {
                fieldName: this.targetRecordInfo.fieldInfo.name,
                pageName: this.targetRecordInfo.fieldInfo.pageName,
                dataTransfer: dataTransfer,
            },
            services: {
                ui: this.uiService,
                dialog: this.dialogService,
            }
        });
        macro.start();
    }
    /**
     * Callback function called when the user clicks on the "Send as Message" button.
     * The function executes a macro that opens the latest form view, composes a
     * new message and attaches the associated file to it.
     * @param {Event} ev
     */
    onClickSendAsMessage(ev) {
        const dataTransfer = this._createHtmlDataTransfer();
        const macro = new SendAsMessageMacro({
            targetXmlDoc: this.targetRecordInfo.xmlDoc,
            breadcrumbs: this.targetRecordInfo.breadcrumbs,
            data: {
                dataTransfer: dataTransfer,
            },
            services: {
                ui: this.uiService,
                dialog: this.dialogService,
            }
        });
        macro.start();
    }
    /**
     * Create a dataTransfer object with the editable content of the template
     * block, to be used for a paste event in the editor
     */
    _createHtmlDataTransfer() {
        const dataTransfer = new DataTransfer();
        const content = this.props.anchor.querySelector('.o_knowledge_content');
        dataTransfer.setData('text/odoo-editor', `<p></p>${content.innerHTML}<p></p>`);
        return dataTransfer;
    }
}

TemplateBehavior.template = "knowledge.TemplateBehavior";
TemplateBehavior.props = {
    ...AbstractBehavior.props,
    content: { type: Object, optional: true },
};
