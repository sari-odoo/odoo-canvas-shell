/** @odoo-module alias=knowledge.wysiwyg*/

import { isEmptyBlock } from "@web_editor/js/editor/odoo-editor/src/OdooEditor";
import Wysiwyg from "web_editor.wysiwyg";

/**
 * This widget will extend Wysiwyg and contain all code that are specific to
 * Knowledge and that should not be included in the global Wysiwyg instance.
 *
 * Note: The utils functions of the OdooEditor are included in a different bundle
 * asset than 'web.assets_backend'. We can therefore not import them in the
 * backend code of Knowledge. This widget will be allow us to use them.
 */
const KnowledgeWysiwyg = Wysiwyg.extend({
    /**
     * Checks if the editable zone of the editor is empty.
     * @returns {boolean}
     */
    isEmpty() {
        return this.$editable[0].children.length === 1 && isEmptyBlock(this.$editable[0].firstElementChild);
    },
});

export default KnowledgeWysiwyg;
