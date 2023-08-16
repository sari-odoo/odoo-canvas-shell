/** @odoo-module */
import { Component, useState } from "@odoo/owl";


/**
 * Toolbar consisting of the Sketchpad Actions
 * @date 8/12/2023 - 11:02:32 PM
 *
 * @export
 * @class SketchTools
 * @typedef {SketchTools}
 * @extends {Component}
 */
export class SketchTools extends Component {

    setup() {
        this.state = useState({
            mode: window.knowledgeCanvas?.mode || "sketch", // ENUM: ["sketch", "erase", "text", "shape"]
            drawingShape: window.knowledgeCanvas?.shape ||"", // the shape that is currently being drawn
            strokeColor: window.knowledgeCanvas?.color || "#000000", // the color of the line
            font: window.knowledgeCanvas?.font || "12px Arial", // the font of the text
        })

        window.addEventListener("modeChange", (ev) => {
            this.state.mode = ev.detail.mode;
            this.state.drawingShape = ev.detail.shape;
        });
        window.addEventListener("colorChange", (ev) => {
            this.state.strokeColor = ev.detail.color;
        });
        window.addEventListener("brushSizeChange", (ev) => {
            this.state.lineWidth = parseInt(ev.detail.lineWidth);
            this.state.font = (ev.detail.lineWidth / 2 + 10) + "px " + this.state.font.split(" ")[1];
        });
        window.addEventListener("fontChange", (ev) => {
            this.state.font = (this.state.lineWidth / 2 + 10) + "px " + ev.detail.font;
        });
    }


    /**
     * Sets the font of the text
     */
    setFont(ev) {
        this.state.font = ev.target.value;
        if (window.knowledgeCanvas) {
            window.knowledgeCanvas.font = ev.target.value;
        }
        else {
            window.knowledgeCanvas = {font: ev.target.value};
        }
        let event = new CustomEvent("fontChange", { detail: { font: ev.target.value } });
        window.dispatchEvent(event);
    }

    /**
     * Sets the drawing colour
     *
     * @param {*} event: input change on type="color"
     */
    setDrawingColor(ev) {
        this.state.strokeColor = ev.target.value
        if (window.knowledgeCanvas)
            window.knowledgeCanvas.color = ev.target.value;
        else
            window.knowledgeCanvas = {color: ev.target.value};
        let event = new CustomEvent("colorChange", { detail: { color: ev.target.value } });
        window.dispatchEvent(event);
    }

    /**
     * Sets the brush size
     *
     * @param {*} event: button click on input type="range"
     */
    setBrushSize(ev) {
        this.state.lineWidth = ev.target.value;
        if (window.knowledgeCanvas)
            window.knowledgeCanvas.lineWidth = ev.target.value;
        else
            window.knowledgeCanvas = {lineWidth: ev.target.value};
        let event = new CustomEvent("brushSizeChange", { detail: { lineWidth: ev.target.value } });
        window.dispatchEvent(event);
    }

    /**
     * Sets the drawing type to either erase or draw
     */
    setDrawMode(mode, shape) {
        this.state.mode = mode;
        this.state.drawingShape = shape;
        if (window.knowledgeCanvas) {
            window.knowledgeCanvas.mode = mode;
            window.knowledgeCanvas.shape = shape;
        }
        else
            window.knowledgeCanvas = { mode, shape };
        let event = new CustomEvent("modeChange", { detail: { mode, shape } });
        window.dispatchEvent(event);
    }
}

SketchTools.template = "odoo_canvas.sketchtools";