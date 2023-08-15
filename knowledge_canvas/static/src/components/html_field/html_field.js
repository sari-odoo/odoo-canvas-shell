/** @odoo-module */

import { HtmlField } from "@web_editor/js/backend/html_field";
// import { htmlField } from "@knowledge_canvas/js/backend/html_field";
import { getWysiwygClass } from "web_editor.loader";
import { patch } from "@web/core/utils/patch";
import { templates } from "@web/core/assets";
import { _lt } from "@web/core/l10n/translation";
import { QWebPlugin } from '@web_editor/js/backend/QWebPlugin';
import { decodeDataBehaviorProps } from "@knowledge/js/knowledge_utils";
import { Deferred, Mutex } from "@web/core/utils/concurrency";
import { useService } from "@web/core/utils/hooks";

// Behaviors:

import { ArticleBehavior } from "@knowledge_canvas/components/behaviors/article_behavior/article_behavior";
import { ArticlesStructureBehavior } from "@knowledge_canvas/components/behaviors/articles_structure_behavior/articles_structure_behavior";
import { FileBehavior } from "@knowledge_canvas/components/behaviors/file_behavior/file_behavior";
import { EmbeddedViewBehavior } from "@knowledge_canvas/components/behaviors/embedded_view_behavior/embedded_view_behavior";
import { TemplateBehavior } from "@knowledge_canvas/components/behaviors/template_behavior/template_behavior";
import { TableOfContentBehavior } from "@knowledge_canvas/components/behaviors/table_of_content_behavior/table_of_content_behavior";
import { ViewLinkBehavior } from "@knowledge_canvas/components/behaviors/view_link_behavior/view_link_behavior";
import { Sketchpad } from '@odoo_canvas/components/sketchpad/sketchpad';
import {
    App,
    markup,
    onWillDestroy,
    onWillUnmount,
    onMounted,
    useEffect,
    useRef,
} from "@odoo/owl";

const HtmlFieldPatchCanvas = {
    /**
     * @override
     */
    setup() {
        this._super(...arguments);
        this.behaviorTypes = {
            o_knowledge_behavior_type_article: {
                Behavior: ArticleBehavior,
            },
            o_knowledge_behavior_type_file: {
                Behavior: FileBehavior,
            },
            o_knowledge_behavior_type_template: {
                Behavior: TemplateBehavior,
            },
            o_knowledge_behavior_type_toc: {
                Behavior: TableOfContentBehavior,
            },
            o_knowledge_behavior_type_articles_structure: {
                Behavior: ArticlesStructureBehavior
            },
            o_knowledge_behavior_type_embedded_view: {
                Behavior: EmbeddedViewBehavior
            },
            o_knowledge_behavior_type_view_link: {
                Behavior: ViewLinkBehavior
            },
            // Add a new behavior type to Knowledge for Canvas object. This will act as the behvior for Canvas object containers in Knowledge.
            o_knowledge_behavior_type_canvas: {
                Behavior: Sketchpad
            },
        };
        this.uiService = useService('ui');
        this.behaviorState = {
            // Owl does not support destroying an App when its container node is
            // not in the DOM. This reference is a `d-none` element used to
            // re-insert anchors of live Behavior App before calling `destroy`
            // to circumvent the Owl limitation.
            handlerRef: useRef("behaviorHandler"),
            // Set of anchor elements with an active Behavior (Owl App) used to
            // keep track of them.
            appAnchors: new Set(),
            // Mutex to prevent multiple _updateBehavior methods running at
            // once.
            updateMutex: new Mutex(),
            // Element currently being observed for Behaviors Components.
            observedElement: null,
            // Observer responsible for mounting Behaviors coming to the DOM,
            // and destroying those that are removed.
            appAnchorsObserver: new MutationObserver(() => {
                // Clean Behaviors that are not currently in the DOM.
                const anchors = this.behaviorState.observedElement.querySelectorAll('.o_knowledge_behavior_anchor');
                const preRenderingAnchors = this.behaviorState.handlerRef.el?.querySelectorAll('.o_knowledge_behavior_anchor') || [];
                this.destroyBehaviorApps(new Set([...anchors, ...preRenderingAnchors]));
                // Schedule a scan for new Behavior anchors to render.
                this.updateBehaviors();
            }),
        };
        this.boundRefreshBehaviors = this._onRefreshBehaviors.bind(this);
        this.knowledgeCommandsService = useService('knowledgeCommandsService');
        // Update Behaviors and reset the observer when the html_field
        // DOM element changes.
        useEffect(() => {
            if (this.behaviorState.observedElement !== this.valueContainerElement) {
                // The observed Element has to be replaced.
                this.behaviorState.appAnchorsObserver.disconnect();
                this.behaviorState.observedElement = null;
                this.destroyBehaviorApps();
                if (this.props.readonly || this.wysiwyg?.odooEditor) {
                    // Restart the observer only if the html_field element is
                    // ready to display its value. If it is not ready (async),
                    // it will be started in @see startWysiwyg.
                    this.startAppAnchorsObserver();
                    this.updateBehaviors();
                }
            }
        }, () => {
            return [this.valueContainerElement];
        });
        onMounted(() => {
            this.dynamicPlaceholder?.setElementRef(this.wysiwyg);
        });
        onWillUnmount(() => {
            this._removeRefreshBehaviorsListeners();
        });
        onWillDestroy(() => {
            this.behaviorState.appAnchorsObserver.disconnect();
            this.destroyBehaviorApps();
        });
    },
    /**
     * @override
     */
    async _getWysiwygClass() {
        return getWysiwygClass({
            moduleName: "knowledge.wysiwyg"
        });
    },
    /**
     * Destroy all currently active Behavior Apps except those which anchor
     * is in `ignoredAnchors`.
     *
     * @param {Set<Element>} ignoredAnchors optional - Set of anchors to ignore
     *        for the destruction of Behavior Apps
     */
    destroyBehaviorApps(ignoredAnchors=new Set()) {
        for (const anchor of Array.from(this.behaviorState.appAnchors)) {
            if (!ignoredAnchors.has(anchor)) {
                this.destroyBehaviorApp(anchor);
            }
        }
    },
    /**
     * Destroy a Behavior App.
     *
     * Considerations:
     * - To mount the Behavior App at a later time based on the same anchor
     * where it was destroyed, it is necessary to keep some Component nodes
     * inside. Since Owl:App.destroy removes all its Component nodes, this
     * method has to clone them beforehand to preserve them.
     * - An Owl App has to be destroyed in the DOM (Owl constraint), but the
     * OdooEditor has no hook to tell if a node will be removed or not.
     * Therefore this method can be called by a MutationObserver, at which point
     * the anchor is not in the DOM anymore and it has to be reinserted before
     * the App can be destroyed. It is done in a custom `d-none` element aside
     * the editable.
     * - Cloned child nodes can be re-inserted after the App destruction in the
     * anchor. It is important to do it even if the anchor is not in the DOM
     * anymore since that same anchor can be re-inserted in the DOM with an
     * editor `undo`.
     *
     * @param {HTMLElement} anchor in which the Behavior is mounted
     */
    destroyBehaviorApp(anchor) {
        // Deactivate the Element in UI service to prevent unwanted behaviors
        this.uiService.deactivateElement(anchor);
        // Preserve the anchor children since they will be removed by the
        // App destruction.
        const clonedAnchor = anchor.cloneNode(true);
        for (const node of clonedAnchor.querySelectorAll('[data-oe-transient-content=""], [data-oe-transient-content="true"]')) {
            node.remove();
        }
        let shouldBeRemoved = false;
        let shouldBeRestored = false;
        const parentNode = anchor.parentNode;
        if (!document.body.contains(anchor)) {
            // If anchor has a parent outside the DOM, it has to be given back
            // to its parent after being destroyed, so it is replaced by its
            // clone (to keep track of its position).
            if (parentNode) {
                parentNode.replaceChild(clonedAnchor, anchor);
                shouldBeRestored = true;
            } else {
                shouldBeRemoved = true;
            }
            // A Component should always be destroyed in the DOM.
            this.behaviorState.handlerRef.el.append(anchor);
        }
        anchor.oKnowledgeBehavior.updatePromise.resolve(false);
        anchor.oKnowledgeBehavior.destroy();
        delete anchor.oKnowledgeBehavior;
        if (shouldBeRemoved) {
            anchor.remove();
        } else if (shouldBeRestored) {
            // Give back the anchor to its original parent (before destroying).
            parentNode.replaceChild(anchor, clonedAnchor);
        }
        // Recover the child nodes from the clone because OWL removed all of
        // them, but they are necessary to re-render the Component later.
        // (it's the blueprint of the Behavior).
        anchor.replaceChildren(...clonedAnchor.childNodes);
        this.behaviorState.appAnchors.delete(anchor);
    },
    /**
     * Observe the element containing the html_field value in the DOM.
     * Since that element can change during the lifetime of the html_field, the
     * observed element has to be held in a custom property (typically to
     * disconnect the observer).
     */
    startAppAnchorsObserver() {
        this.behaviorState.observedElement = this.valueContainerElement;
        this.behaviorState.appAnchorsObserver.observe(this.behaviorState.observedElement, {
            subtree: true,
            childList: true,
        });
    },
    /**
     * The editor has to pause (collaborative) external steps when a new
     * Behavior (coming from an external step) has to be rendered, because
     * some of the following external steps could concern a rendered element
     * inside the Behavior. This override adds a callback for the editor to
     * specify when he should stop applying external steps (the callback
     * analyzes the editable, checks if a new Behavior has to be rendered, and
     * returns a promise resolved when that Behavior is rendered).
     *
     * @override
     */
    get wysiwygOptions() {
        const options = this._super();
        /**
         * @param {Element} element to scan for new Behaviors
         * @returns {Promise|null} resolved when the pre-rendering is done, or
         *                         null if there is nothing to pre-render
         */
        const renderExternalBehaviors = (element) => {
            let behaviorsData = [];
            // Check that the mutex is idle synchronously to avoid unnecessary
            // overheads in the editor that would be caused by returning a
            // resolved Promise instead of null.
            if (!this.behaviorState.updateMutex._unlockedProm) {
                behaviorsData = this._scanFieldForBehaviors(element);
                if (!behaviorsData.length) {
                    return null;
                }
            }
            return this.updateBehaviors(behaviorsData, element);
        };
        options.postProcessExternalSteps = renderExternalBehaviors;
        return options;
    },
    /**
     * Returns the container which holds the current value of the html_field
     * if it is already mounted and ready.
     *
     * @returns {HTMLElement}
     */
    get valueContainerElement() {
        if (this.props.readonly && this.readonlyElementRef.el) {
            return this.readonlyElementRef.el;
        } else if (this.wysiwyg?.odooEditor) {
            return this.wysiwyg.odooEditor.editable;
        }
        return null;
    },
    /**
     * @override
     */
    async startWysiwyg() {
        await this._super(...arguments);
        this._addRefreshBehaviorsListeners();
        this.startAppAnchorsObserver();
        await this.updateBehaviors();
        const behaviorBlueprint = this.knowledgeCommandsService.popPendingBehaviorBlueprint({
            model: this.env.model?.root?.resModel,
            field: this.props.name,
            resId: this.env.model?.root?.resId,
        });
        if (behaviorBlueprint) {
            this.wysiwyg.appendBehaviorBlueprint(behaviorBlueprint);
        }
    },
    /**
     * This function is called in the process of commitChanges and will disable
     * Behavior rendering and destroy all currently active Behaviors, because
     * the super function will do heavy changes in the DOM that are not
     * supported by OWL.
     * Behaviors rendering is re-enabled after the processing of the super
     * function is done, but Behaviors are not restarted (they will be in
     * updateValue, function that is called after _toInline if the html_field
     * is not in a destroyed Owl state).
     *
     * @override
     */
    async _toInline() {
        const _super = this._super.bind(this);
        // Prevent any new Behavior rendering during `toInline` processing.
        this.behaviorState.appAnchorsObserver.disconnect();
        this._removeRefreshBehaviorsListeners();
        // Wait for the `udpateBehaviors` mutex to ensure that it is idle during
        // `toInline` processing (we don't want it to mess with DOM nodes).
        await this.behaviorState.updateMutex.getUnlockedDef();
        // Destroy all Behaviors because `toInline` will apply heavy changes
        // in the DOM that are not supported by OWL. The nodes generated by
        // OWL stay in the DOM as the html_field value, but are not managed
        // by OWL during the `toInline` processing.
        this.destroyBehaviorApps();
        await _super(...arguments);
        // Reactivate Behavior rendering.
        this._addRefreshBehaviorsListeners();
        this.startAppAnchorsObserver();
    },
    /**
     * @override
     */
    async updateValue() {
        const _super = this._super.bind(this);
        // Update Behaviors to ensure that they all are properly mounted, and
        // wait for the mutex to be idle.
        await this.updateBehaviors();
        await _super(...arguments);
    },
    /**
     * Mount Behaviors in visible anchors that should contain one.
     *
     * Since any mutation can trigger an updateBehaviors call, the mutex ensure
     * that the next updateBehaviors call always await the previous one.
     *
     * @param {Array[Object]} behaviorsData - optional - Contains information on
     *                        which Behavior to update. If not set, the
     *                        html_field will handle every visible Behavior
     *                        Composed by:
     *     @param {HTMLElement} [behaviorsData.anchor] Element which content
     *                          will be replaced by the rendered Component
     *                          (Behavior)
     *     @param {string} [behaviorsData.behaviorType] Class name of the
     *                      Behavior @see behaviorTypes
     *     edit mode only options:
     *     @param {string} [behaviorsData.behaviorStatus] optional - Depending
     *                     on how the Behavior is inserted, it should be handled
     *                     differently. Statuses:
     * - undefined:        - No need for extra care, the anchor is and
     *                       will stay present in the editable until the
     *                       Behavior finishes being pre-rendered
     * - 'new':            - Result of a wysiwyg command, the anchor is not
     *                       in the editable and as such there is no OID to
     *                       recover from the blueprint (html value before
     *                       Component rendering)
     *     @param {Function} [behaviorsData.insert] optional - Instructions on
     *                       how to insert the Behavior when pre-rendering is
     *                       done. Takes the Element to be inserted as an
     *                       argument
     *     @param {Function} [behaviorsData.restoreSelection] optional - Method
     *                       to restore the selection in the editable before
     *                       inserting the rendered Behavior at the correct
     *                       position (where the user typed the command)
     *     @param {boolean} [behaviorsData.setCursor] optional - Whether to use
     *                      the setCursor method of the Behavior if it has one
     *                      when it is mounted and inserted in the editable
     * @param {HtmlElement} target - optional - the node to scan for new
     *                      Behavior to instanciate. Defaults to
     *                      this.valueContainerElement
     * @returns {Promise} Resolved when the mutex updating Behaviors is idle.
     */
    async updateBehaviors(behaviorsData = [], target = null) {
        this.behaviorState.updateMutex.exec(() => this._updateBehaviors(behaviorsData, target));
        return this.behaviorState.updateMutex.getUnlockedDef();
    },
    async _updateBehaviors(behaviorsData, target) {
        if (!document.body.contains(this.valueContainerElement)) {
            // Validate that the working environment is ready.
            return;
        }
        const renderingContainerElement = (this.props.readonly) ? target || this.readonlyElementRef.el : this.behaviorState.handlerRef.el;
        target = target || this.valueContainerElement;
        if (!behaviorsData.length) {
            behaviorsData = this._scanFieldForBehaviors(target);
        }
        const promises = [];
        for (const behaviorData of behaviorsData) {
            const {Behavior} = this.behaviorTypes[behaviorData.behaviorType] || {};
            if (!Behavior || (
                    !behaviorData.behaviorStatus &&
                    !document.body.contains(behaviorData.anchor)
                )
            ) {
                // Trying to mount components on nodes that were removed from
                // the DOM => no need handle this Behavior. It can happen
                // because this function is asynchronous but onPatched and
                // onMounted are synchronous and do not wait for their content
                // to finish so the life cycle of the component can continue
                // during the execution of this function.
                continue;
            } else if (behaviorData.anchor.oKnowledgeBehavior) {
                // If a Behavior is already instantiated, no need to redo-it.
                continue;
            }
            // Anchor is the node inside which the Component will be rendered.
            let anchor;
            if (this.props.readonly) {
                anchor = behaviorData.anchor;
            } else if (behaviorData.behaviorStatus === 'new') {
                anchor = behaviorData.anchor;
                renderingContainerElement.append(anchor);
            } else {
                anchor = behaviorData.anchor.cloneNode(false);
                anchor.oid = behaviorData.anchor.oid;
                renderingContainerElement.append(anchor);
                behaviorData.insert = (anchor) => {
                    if (this.wysiwyg.odooEditor.editable.contains(behaviorData.anchor)) {
                        // Ignore the insertion if the preRendered element
                        // cannot be moved in the DOM.
                        this.wysiwyg.odooEditor.observerUnactive('knowledge_update_behaviors');
                        behaviorData.anchor.parentElement.replaceChild(anchor, behaviorData.anchor);
                        // Bypass the editor observer, so oids needs to be set
                        // manually.
                        this.wysiwyg.odooEditor.idSet(anchor);
                        this.wysiwyg.odooEditor.observerActive('knowledge_update_behaviors');
                    }
                };
            }
            // Default props for every Behavior.
            const props = {
                readonly: this.props.readonly,
                anchor: anchor,
                wysiwyg: this.wysiwyg,
                record: this.props.record,
                // readonlyElementRef.el or editable
                root: this.valueContainerElement,
            };
            let behaviorProps = {};
            if (behaviorData.anchor.hasAttribute("data-behavior-props")) {
                // Parse non-html props stored on the anchor of the Behavior.
                try {
                    behaviorProps = decodeDataBehaviorProps(behaviorData.anchor.dataset.behaviorProps);
                } catch (error){
                    // If data-behavior-props can not be decoded, ignore it.
                    // User can then choose to remove it or not if the Behavior
                    // is broken as a result of this.
                    console.warn(error.message);
                }
            }
            // Add non-html props of the Behavior, that were stored (encoded)
            // in the data-behavior-props attribute.
            for (const prop in behaviorProps) {
                if (prop in Behavior.props) {
                    props[prop] = behaviorProps[prop];
                }
            }
            // Add html props of the Behavior, each one of them is stored in a
            // (sub-)child element of the anchor with the attribute
            // data-prop-name, the name of the prop is the attribute value, and
            // the value of the prop is the content of that node).
            const propNodes = behaviorData.anchor.querySelectorAll("[data-prop-name]");
            for (const node of propNodes) {
                if (node.dataset.propName in Behavior.props) {
                    // Safe because sanitized by the editor and backend.
                    props[node.dataset.propName] = markup(node.innerHTML);
                }
            }
            if (!this.props.readonly) {
                // Take a snapshot of the resId of the current article
                // to verify that the insertion of the Behavior takes place
                // in the correct article.
                const targetRecordId = this.env.model?.root?.resId;
                // Callback to insert a preRendered Behavior in the editable.
                props.onPreRendered = () => {
                    try {
                        if (targetRecordId !== this.env.model?.root?.resId) {
                            // If the prerendering finished after the user
                            // changed record, ignore the insertion.
                            return;
                        }
                        if (behaviorData.restoreSelection) {
                            behaviorData.restoreSelection();
                        }
                    } catch (error) {
                        if (!(error instanceof DOMException)) {
                            throw error;
                        }
                        // Ignore the insertion if the preRendered element
                        // can not be moved in the DOM.
                        console.warn(error.message);
                        return;
                    }
                    if (behaviorData.insert) {
                        behaviorData.insert(anchor);
                    } else {
                        this.wysiwyg.odooEditor.execCommand('insert', anchor);
                    }
                    if (this.wysiwyg?.odooEditor && behaviorData.setCursor &&
                        behaviorData.anchor.oKnowledgeBehavior.root.component.setCursor) {
                        behaviorData.anchor.oKnowledgeBehavior.root.component.setCursor();
                    }
                };
                if (behaviorData.behaviorStatus !== 'new') {
                    // Copy the current state of the Behavior blueprint
                    // before it is modified, in order to save the current
                    // OIDs and recover them when the Component is rendered.
                    props.blueprint = document.createElement('DIV');
                    props.blueprint.append(...behaviorData.anchor.childNodes);
                }
            }
            // Empty the anchor because OWL will fill it with the rendered
            // Behavior.
            anchor.replaceChildren();
            const config = (({env, dev, translatableAttributes, translateFn}) => {
                env = Object.create(env);
                Object.assign(env, {
                    // Register "beforeLeave" callbacks in the environment
                    // of the Behavior. If the Behavior does a doAction,
                    // those callbacks will be called for this field.
                    __beforeLeave__: this.env.__beforeLeave__,
                });
                return { env, dev, translatableAttributes, translateFn };
            })(this.__owl__.app);
            anchor.oKnowledgeBehavior = new App(Behavior, {
                ...config,
                templates,
                props,
            });
            this.behaviorState.appAnchors.add(anchor);
            // App.mount is not resolved if the App is destroyed before it
            // is mounted, so instead, await a Deferred that is resolved
            // when the App is mounted (true) or destroyed (false).
            anchor.oKnowledgeBehavior.updatePromise = new Deferred();
            anchor.oKnowledgeBehavior.mount(anchor).then(
                () => anchor.oKnowledgeBehavior.updatePromise.resolve(true)
            );
            const promise = anchor.oKnowledgeBehavior.updatePromise.then(async (isMounted) => {
                // isMounted is true if the App was mounted and false if it
                // was destroyed before being mounted. If it was mounted,
                // update child behaviors inside anchor
                if (isMounted) {
                    await this._updateBehaviors([], anchor);
                }
            });
            promises.push(promise);
        }
        await Promise.all(promises);
    },
    _addRefreshBehaviorsListeners() {
        if (this.wysiwyg?.odooEditor?.editable) {
            this.wysiwyg.odooEditor.editable.addEventListener('refresh_behaviors', this.boundRefreshBehaviors);
        }
    },
    _onRefreshBehaviors(ev) {
        const {behaviorData} = ev.detail || {};
        this.updateBehaviors((behaviorData) ? [behaviorData] : []);
    },
    _removeRefreshBehaviorsListeners() {
        if (this.wysiwyg?.odooEditor?.editable) {
            this.wysiwyg.odooEditor.editable.removeEventListener('refresh_behaviors', this.boundRefreshBehaviors);
        }
    },
    /**
     * Scans the target for Behaviors to mount.
     *
     * @param {HTMLElement} target Element to scan for Behaviors
     * @returns {Array[Object]} Array filled with the results of the scan.
     *          Any Behavior that is not instanciated at the moment of the scan
     *          will have one entry added in this Array, with the condition that
     *          it is not a child of another Behavior that is not mounted yet
     *          (those will have to be scanned again when their parent is
     *          mounted, because their anchor will change). Existing items of
     *          the Array will not be altered.
     */
    _scanFieldForBehaviors(target) {
        const behaviorsData = [];
        const types = new Set(Object.getOwnPropertyNames(this.behaviorTypes));
        const anchors = target.querySelectorAll('.o_knowledge_behavior_anchor');
        const anchorsSet = new Set(anchors);
        // Iterate over the list of nodes while the set will be modified.
        // Only keep anchors of Behaviors that have to be rendered first.
        for (const anchor of anchors) {
            if (!anchorsSet.has(anchor)) {
                // anchor was already removed (child of another anchor)
                continue;
            }
            if (anchor.oKnowledgeBehavior) {
                anchorsSet.delete(anchor);
            } else {
                // If the Behavior in anchor is not already mounted, remove
                // its children Behaviors from the scan, as their anchor will
                // change when this Behavior is mounted (replace all children
                // nodes by their mounted version). They will be mounted after
                // their parent during _updateBehaviors.
                const anchorSubNodes = anchor.querySelectorAll('.o_knowledge_behavior_anchor');
                for (const anchorSubNode of anchorSubNodes) {
                    anchorsSet.delete(anchorSubNode);
                }
            }
        }
        for (const anchor of anchorsSet) {
            const type = Array.from(anchor.classList).find(className => types.has(className));
            if (type) {
                behaviorsData.push({
                    anchor: anchor,
                    behaviorType: type,
                });
            }
        }
        return behaviorsData;
    },
};

const extractProps = HtmlField.extractProps;

HtmlField.extractProps = ({ attrs, field }) => {
    const props = extractProps({ attrs, field });
    props.wysiwygOptions.knowledgeCommands = attrs.options.knowledge_commands;
    // props.wysiwygOptions.editorPlugins.push(KnowledgePlugin);
    if ('allowCommandFile' in attrs.options) {
        props.wysiwygOptions.allowCommandFile = Boolean(attrs.options.allowCommandFile);
    }
    return props;
};

patch(HtmlField.prototype, 'knowledge_html_field_canvas', HtmlFieldPatchCanvas);

// patch(HtmlField.prototype, 'knowledge_html_field_canvas', HtmlFieldPatchCanvas);

// patch(htmlField, "knowledge_html_field_canvas", {
//     supportedOptions: [...htmlField.supportedOptions, {
//         label: _lt("Enable Knowledge commands"),
//         name: "knowledge_commands",
//         type: "boolean"
//     }],
//     extractProps({ attrs, options }, dynamicInfo) {
//         const wysiwygOptions = {
//             placeholder: attrs.placeholder,
//             noAttachment: attrs.options['no-attachment'],
//             inIframe: Boolean(attrs.options.cssEdit),
//             iframeCssAssets: attrs.options.cssEdit,
//             iframeHtmlClass: attrs.iframeHtmlClass,
//             snippets: attrs.options.snippets,
//             mediaModalParams: {
//                 noVideos: 'noVideos' in attrs.options ? attrs.options.noVideos : true,
//                 useMediaLibrary: true,
//             },
//             linkForceNewWindow: true,
//             tabsize: 0,
//             height: attrs.options.height,
//             minHeight: attrs.options.minHeight,
//             maxHeight: attrs.options.maxHeight,
//             resizable: 'resizable' in attrs.options ? attrs.options.resizable : false,
//             editorPlugins: [QWebPlugin],
//         };
//         if ('collaborative' in attrs.options) {
//             wysiwygOptions.collaborative = attrs.options.collaborative;
//             // Two supported triggers:
//             // 'start': Join the peerToPeer connection immediately
//             // 'focus': Join when the editable has focus
//             wysiwygOptions.collaborativeTrigger = attrs.options.collaborative_trigger || 'focus';
//         }
//         if ('style-inline' in attrs.options) {
//             wysiwygOptions.inlineStyle = Boolean(attrs.options.styleInline);
//         }
//         if ('allowCommandImage' in attrs.options) {
//             // Set the option only if it is explicitly set in the view so a default
//             // can be set elsewhere otherwise.
//             wysiwygOptions.allowCommandImage = Boolean(attrs.options.allowCommandImage);
//         }
//         if ('allowCommandVideo' in attrs.options) {
//             // Set the option only if it is explicitly set in the view so a default
//             // can be set elsewhere otherwise.
//             wysiwygOptions.allowCommandVideo = Boolean(attrs.options.allowCommandVideo);
//         }
//         const props = {
//             codeview: Boolean(odoo.debug && attrs.options.codeview),
//             placeholder: attrs.placeholder,
//             sandboxedPreview: Boolean(attrs.options.sandboxedPreview),

//             isCollaborative: attrs.options.collaborative,
//             cssReadonlyAssetId: attrs.options.cssReadonly,
//             dynamicPlaceholder: attrs.options?.dynamic_placeholder || false,
//             dynamicPlaceholderModelReferenceField: attrs.options?.dynamic_placeholder_model_reference_field || "",
//             cssEditAssetId: attrs.options.cssEdit,
//             isInlineStyle: attrs.options['style-inline'],
//             wrapper: attrs.options.wrapper,

//             wysiwygOptions,
//             hasReadonlyModifiers: attrs.options.readonly,
//         };
//         props.wysiwygOptions.knowledgeCommands = attrs.options.knowledge_commands;
//         if ('allowCommandFile' in attrs.options) {
//             props.wysiwygOptions.allowCommandFile = Boolean(attrs.options.allowCommandFile);
//         }
//         return props;
//     },
// });
