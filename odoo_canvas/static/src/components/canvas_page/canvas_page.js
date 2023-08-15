/** @odoo-module **/

import { Sketchpad } from "../sketchpad/sketchpad";
import { Component } from "@odoo/owl";

/**
 * This funciton contains all components that we will be displaying in the template
 * @date 7/10/2023 - 2:09:40 PM
 *
 * @export
 * @class CanvasPage
 * @typedef {CanvasPage}
 * @extends {Component}
 */
export class CanvasPage extends Component {
  static template = "odoo_canvas.canvas_page";
  static components = { Sketchpad };
}
