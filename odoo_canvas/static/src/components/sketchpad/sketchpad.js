/** @odoo-module */
import { session } from "@web/session";
import { useState, useRef, onMounted, onWillUnmount, onWillStart } from "@odoo/owl";
import { AbstractBehavior } from "@knowledge_canvas/components/behaviors/abstract_behavior/abstract_behavior";
import { useService } from "@web/core/utils/hooks";
import {
  encodeDataBehaviorProps,
} from "@knowledge/js/knowledge_utils";
import { SketchTools } from "../sketchtools/sketchtools";

const FREE_SKETCH_MODES = ["sketch", "erase"];

/**
 * This contains the logic of the sketchpad component which includes methods for drawing on the canvas
 * @date 7/10/2023 - 2:10:37 PM
 *
 * @export
 * @class Sketchpad
 * @typedef {Sketchpad}
 * @extends {AbstractBehavior}
 */
export class Sketchpad extends AbstractBehavior {
  canvasRefListenersMap = new Map([
    ["mousedown", (ev) => this.onMouseDown(ev)],
    ["touchstart", (ev) => this.onMouseDown(ev)],
    ["mouseout", (ev) => this.onMouseOut(ev)],
    ["mouseup", (ev) => this.onMouseUp(ev)],
    ["touchend", (ev) => this.onMouseUp(ev)],
    ["mousemove", (ev) => this.sketch(ev)],
    ["touchmove", (ev) => this.onTouchMove(ev)],
    ["click", (ev) => this.sketchClick(ev)],
    ["touch", (ev) => this.sketchClick(ev)],
  ]);

  setup() {
    super.setup();
    this.orm = useService("orm");
    this.rpc = require('web.rpc');
    this.addImage = this.addImage.bind(this);
    this.loadImage = this.loadImage.bind(this);
    this.handleFile = this.handleFile.bind(this);
    this.clearCanvas = this.clearCanvas.bind(this);
    this.toggleModal = this.toggleModal.bind(this);
    this.saveImage = this.saveImage.bind(this);
    this.undo = this.undo.bind(this);

    /**
     * @templates name: String, url: Link to Img Src, strokeColor: hex color to change stroke color to.
     */
    this.templates = [
      {
        "name": "Blackboard",
        "url": "/odoo_canvas/static/description/blackboard.jpg",
        "strokeColor": "#FFFFFF"
      },
      {
        "name": "Notebook Paper",
        "url": "/odoo_canvas/static/description/notebook_paper.jpg",
        "strokeColor": "#0000FF"
      },
      {
        "name": "Bar Graph",
        "url": "/odoo_canvas/static/description/bar_graph.jpg",
        "strokeColor": "#000000"
      }
    ]

    if (!this.props.anchor.dataset.behaviorProps) {
      this.props.anchor.dataset.behaviorProps = encodeDataBehaviorProps({
          sketchpadId: this.props.sketchpadId,
      });
    }

    this.state = useState({
      // Canvas - DOM
      canvasContext: null, // the canvas context
      overlayCanvasContext: null, // the canvas used for drawing shapes
      backgroundTemplateContext: null, // the canvas used for background template
      canvasHeight: 500, // the height of the canvas
      canvasWidth: 1000, // the width of the canvas
      isMinimized: false, // used to determine if the toolbar is minimized

      // Canvas - Drawing
      strokeColor: window.knowledgeCanvas?.color || "#000000", // the color of the line
      lineWidth: window.knowledgeCanvas?.lineWidth || 5, // the width of the line
      mode: window.knowledgeCanvas?.mode || "sketch", // ENUM: ["sketch", "erase", "text", "shape"]
      isMousePressed: false, // used to determine if the mouse is pressed
      drawingShape: window.knowledgeCanvas?.shape ||"", // the shape that is currently being drawn
      initialMouseCordinates: { x: null, y: null }, // the initial coordinates of the shape
      touchCoordinates: { x: null, y: null }, // the coordinates of the touch
      font: "12px Arial", // the font used for text
      selectedShape: null, // the shape that is currently being dragged
      disableClick: false, // used to block click events
      placingImage: false, // used to determine if an image is being placed

      // Collaboration
      actionHistory: [], // the history of actions taken by the user
      allStrokes: [], // the history of actions taken by all users
      shapeHistory: [], // the history of shapes drawn by all users
      user: String(session.partner_id) || 'G' + Date.now(), // partner_id or G (guest) + the timestamp of initialization
      id: parseInt(this.props.sketchpadId)
    });

    onWillStart(async () => {
      const data = await this.orm.searchRead('knowledge_canvas.sketchpad_stroke_history', [
        ["sketchpad_seq_id", "=", this.state.id]
      ], ['stroke', 'user_identifier', 'deleted']);
      this.state.allStrokes = data.map((stroke) => {
        stroke.stroke.deleted = stroke.deleted;
        return stroke.stroke;
      });
      // get list of strokes from server
      const strokesCache = await this.orm.call(
        'knowledge_canvas.sketchpad_stroke_history',
        'join_sketchpad_session',
        [this.state.id], { 'sketchpad_id': this.state.id }
      )
      this.state.allStrokes = this.state.allStrokes.concat(strokesCache.strokes)
      // Initialize the stroke to be the next stroke in the sequence for the user
      this._strokeId = this.state.allStrokes.reduce((max, stroke) => stroke.user === this.state.user ? Math.max(max, stroke.id) : max, -1) + 1;
      const channel = "knowledge_canvas_sketchpad_stroke_" + this.state.id
      this.env.services['bus_service'].addChannel(channel);
      this.env.services['bus_service'].addEventListener('notification', this.peekNotificationsInChannel.bind(this));
      this.env.services['bus_service'].start();
    });

    /**
     * When the OWL component is mounted, this function initializes the
     * canvas context and adds event listeners. It also sets the canvas
     * dimensions and adds an overlay canvas to be used for drawing shapes.
     */
    onMounted(() => {
      this.state.canvasContext = this.canvasRef.el.getContext("2d", {willReadFrequently: true});
      this.state.overlayCanvasContext = this.overlayCanvasRef.el.getContext(
        "2d", {willReadFrequently: true}
      );
      this.state.backgroundTemplateContext = this.backgroundTemplateRef.el.getContext("2d");

      this.state.canvasWidth = this.canvasRef.el.offsetWidth;
      this.state.canvasHeight = this.canvasRef.el.offsetHeight;
      this.setDimensions(this.canvasRef.el, this.state.canvasHeight, this.state.canvasWidth);
      this.setDimensions(this.overlayCanvasRef.el, this.state.canvasHeight, this.state.canvasWidth);
      this.setDimensions(this.backgroundTemplateRef.el, this.state.canvasHeight, this.state.canvasWidth);

      // fill the background template with default white
      this.clearBackground();

      this.canvasRefListenersMap.forEach((handler, eventType) => {
        this.overlayCanvasRef.el.addEventListener(eventType, handler);
      });

      this.drawTextInputRef.el.addEventListener("blur", (event) => this.onTextBlur(event));

      this.resizer = this.canvasRef.el.parentElement.querySelector('.resizer');
      this.resizer.addEventListener('mousedown', (event) => this.mouseDownHandler(event));

      if(document.getElementsByClassName('canvas_elements_wrapper').length == 1) {
        window.addEventListener("resize", () => this.debouncedHandleResize());
        window.addEventListener("visibilitychange", () => this.flushToDatabase());
      }

      window.addEventListener("modeChange", (ev) => {
        this.setDrawMode(ev.detail.mode, ev.detail.shape);
      });

      window.addEventListener("colorChange", (ev) => {
        this.state.strokeColor = ev.detail.color;
      });

      window.addEventListener("brushSizeChange", (ev) => {
        let lineWidth = parseInt(ev.detail.lineWidth);
        let font = (lineWidth / 2 + 10 )+ "px " + this.state.font.split(" ")[1];
        this.state.lineWidth = lineWidth;
      });

      this.state.overlayCanvasContext.lineCap = "round";
      this.state.canvasContext.lineCap = "round";
      this.state.canvasContext.lineJoin = "round";

      this.templateModalRef.el.style.display = 'none'; //prevent double clicking on bg template button

      this.drawActionHistory();
    });


    onWillUnmount(() => {
      this._removeCanvasEventListeners()
    });
  }

  canvasRef = useRef("canvas");
  overlayCanvasRef = useRef("overlayCanvas");
  drawTextInputRef = useRef("drawTextInput");
  backgroundTemplateRef = useRef("backgroundTemplate");
  _strokeId = 0;  // used to keep track of the stroke id
  templateModalRef = useRef("backgroundTemplateModal")

  async peekNotificationsInChannel(notification) {
    if (notification && notification.detail && notification.detail.length > 0) {
      let payload = notification.detail, strokes = [], deletions = [];
      payload.forEach((el) => {
        if (el.type == 'update_canvas' && el.payload.stroke_actions[0].user !== this.state.user && el.payload.sketchpad_id == this.state.id) {
          this.state.allStrokes = this.state.allStrokes.concat(el.payload.stroke_actions)
          strokes = strokes.concat(el.payload.stroke_actions)
          for (const stroke of el.payload.stroke_actions) {
            if (stroke.action === 'deleteOne') {
              deletions.push({id: stroke.params.localId, user: stroke.params.createdBy});
            }
            if (stroke.action === 'deleteMany') {
              for (let i = stroke.params.start; i <= stroke.params.end; i++) {
                deletions.push({id: i, user: stroke.params.createdBy});
              }
            }
          }
        }
      });
      if (deletions.length)
        this.executeDeletions(deletions);
      else if (strokes.length)
        this.drawActionHistory(strokes, false);
    }
  }

  flushToDatabase() {
    this.rpc.query({
        model: 'knowledge_canvas.sketchpad_stroke_history',
        method: 'sync_cache_to_database',
    }).then(() => {})
  }

  _removeCanvasEventListeners() {
    this.canvasRefListenersMap.forEach((handler, eventType) => {
      this.overlayCanvasRef.el.removeEventListener(eventType, handler);
    });

    this.drawTextInputRef.el.removeEventListener("blur", () => this.onTextBlur());
    this.resizer.removeEventListener('mousedown', (event) => this.mouseDownHandler(event));

    if(document.getElementsByClassName('canvas_elements_wrapper').length == 1) {
      window.removeEventListener("visibilitychange", () => this.flushToDatabase());
      window.removeEventListener("resize", () => this.debouncedHandleResize());
    }
  }
  /**
   * Minimizes or maximizes the toolbar
   */
  minimize() {
    this.isMinimized = !this.isMinimized;

    const toolbar_div = document.getElementsByClassName("toolbar")[0];
    const minimize_button = document.getElementsByClassName("tool-btn")[0];
    const icon = this.isMinimized ? '<i class="fa fa-plus icon"></i>' : '<i class="fa fa-minus icon"></i>';

    toolbar_div.classList.toggle('hidden_toolbar', this.isMinimized);
    minimize_button.innerHTML = icon;
  }

  /**
   * Function to find the index of the most recent clear canvas action which can be used to skip redundant strokes while re-drawing canvas
   *
   * @returns {number} index of the most recent clear canvas action
   */
  findRecentClearCanvasAction() {
    for (let i = this.state.allStrokes.length - 1; i >= 0; i--) {
      if (this.state.allStrokes[i].action === 'clear' && !this.state.allStrokes[i].deleted) {
        return i+1;
      }
    }
    return 0;
  }

  /**
   * Function to change the background template
   * @param {Object} template template object stored the object list above
   */
  changeBackgroundTemplate(template){
    // If "clear" was chosen, clear the template and save the history. Else, find the template, render it to template canvas, and save history.
    if (template === "clear"){
      this.clearBackground();
      this.generateActionHistory("template", {
        imgSrc: this.backgroundTemplateRef.el.toDataURL("image/jpeg")
      });
    }
    else {
      // find the url of the selected template and render in to the background template layer
      const imgSrc = this.templates.find(t => t.name === template.name).url;
      const img = new Image();
      img.src = imgSrc;

      img.onload = () => {
        this.state.backgroundTemplateContext.drawImage(img, 0, 0, this.state.canvasWidth, this.state.canvasHeight);
        this.state.strokeColor = template.strokeColor;

        // generate Action History for the template for collaboration
        this.generateActionHistory("template", {
          imgSrc: this.backgroundTemplateRef.el.toDataURL("image/jpeg")
        });
      }
    }

    this.toggleModal(); // closes modal
  }

  /**
   * Clear the background template, set it to default white.
   */
  clearBackground(){
    this.state.backgroundTemplateContext.clearRect(0,0,this.state.canvasWidth, this.state.canvasHeight);
    this.state.backgroundTemplateContext.fillStyle = "white";
    this.state.backgroundTemplateContext.fillRect(0,0,this.state.canvasWidth,this.state.canvasHeight);
  }

  /**
   *
   * Takes uploaded image and draws background canvas
   *
   * @param {*} file the file retrieved from addImage() function
   */
  async handleBackground(file) { //could probably refactor
    const imgSrc = await this.loadImage(file);
    const img = new Image();
    img.src = imgSrc;

    img.onload = () => {
      // TO DO: move this into its own compress() function
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");

      // set the dimensions of the temp canvas
      this.setDimensions(tempCanvas, this.state.canvasHeight, this.state.canvasWidth);

      // draw the og image on the temp canvas in order to compress
      tempCtx.drawImage(img,0,0,this.state.canvasWidth,this.state.canvasHeight);

      // compress the img from the temp canvas and draw it on the background template canvas
      const compressedImg = new Image();
      compressedImg.src = tempCanvas.toDataURL("image/jpeg");
      this.state.backgroundTemplateContext.drawImage(compressedImg,0,0);

      this.generateActionHistory("template", {
        imgSrc: compressedImg.src
      });
    }
    this.toggleModal(); // closes modal
  }

  /**
   * Toggles Background Template Modal
   */
  toggleModal(){
    const modal = this.templateModalRef.el;
    modal.style.display === "none" ? modal.style.display = "block" : modal.style.display = "none";
  }

  /**
   * Set the dimensions of a canvas
   * @param {*} canvas canvas element
   * @param {number} height
   * @param {number} width
   */
  setDimensions(canvas, height, width){
    canvas.height = height;
    canvas.width = width;
  }


  /**
   * Handles the canvas dimensions when resizing the window
   */
  handleResize() {
    document.addEventListener('DOMContentLoaded', () => {
      let width = this.canvasRef.el.offsetWidth;
      let height = this.canvasRef.el.offsetHeight;

    // Step 1: Create temporary canvases to hold the scaled images
    const tempCanvas = document.createElement('canvas');
    const tempBackground = document.createElement('canvas');
    this.setDimensions(tempCanvas, height, width);
    this.setDimensions(tempBackground, height, width);

    const tempContext = tempCanvas.getContext('2d');
    const tempBackgroundContext = tempBackground.getContext('2d');

    // Step 2: Draw the original image onto the temporary canvas with the desired width and height
    tempContext.drawImage(this.canvasRef.el, 0, 0, this.state.canvasWidth, this.state.canvasHeight, 0, 0, width, height);
    tempBackgroundContext.drawImage(this.backgroundTemplateRef.el, 0, 0, this.state.canvasWidth, this.state.canvasHeight, 0, 0, width, height);

    // Step 3: Get the image data from the temporary canvas
    const scaledCanvasData = tempContext.getImageData(0, 0, width, height);
    const scaledBackgroundData = tempBackgroundContext.getImageData(0, 0, width, height);

    // Step 4: Update the canvas dimensions and put the scaled image data onto the main canvas
    let canvases = [this.canvasRef.el, this.overlayCanvasRef.el, this.backgroundTemplateRef.el]; // find way to make this global
    this.state.canvasWidth = width;
    this.state.canvasHeight = height;

    canvases.forEach((canvas) => {
      this.setDimensions(canvas, height, width);
    });

    this.state.canvasContext.putImageData(scaledCanvasData, 0, 0);
    this.state.backgroundTemplateContext.putImageData(scaledBackgroundData, 0, 0);

      this.state.canvasContext.lineCap = "round";
      this.state.overlayCanvasContext.lineCap = "round";
      this.drawActionHistory(this.state.allStrokes);
    });
  }

  debouncedHandleResize = _.debounce(this.handleResize, 200);
  debouncedEnableClick = _.debounce(() => {
    this.state.disableClick = false;
  }, 200);

  /**
   * Appends an object to the action history array
   *
   * The params object contains the following properties:
   * - initialCoordinates: the initial coordinates of the action
   * - currentCoordinates: the current coordinates of the action
   * - color: the color of the action
   * - lineWidth: the width of the action
   * - text: the text of the action [only for text actions]
   * - font: the font of the action [only for text actions]
   *
   * @param {string} action : the action taken by the user ["arc", "fillRect", "line", "text", "point", "clear", "freeSketchStart", ...]
   * @param {Object} params : (optional) mousePosition, prevCoordinates, text
   */
  generateActionHistory(
    action,
    params = {}
  ) {
    const actionEntry = { id: this._strokeId, action, user: this.state.user, params };
    this._strokeId++;
    this.state.actionHistory.push(actionEntry);
    this.state.allStrokes.push(actionEntry);
    this.throttledSyncActionHistory();
  }

  mouseDownHandler(e) {
    // Get the current mouse position
    this.state.resize_y = e.pageY;

    // Store the bound function references in variables
    this.boundMouseMoveHandler = this.mouseMoveHandler.bind(this);
    this.boundMouseUpHandler = this.mouseUpHandler.bind(this);

    window.addEventListener('mousemove', this.boundMouseMoveHandler);
    window.addEventListener('mouseup', this.boundMouseUpHandler);
  }

  mouseMoveHandler(e) {
    // How far the mouse has been moved
    const dy = e.pageY - this.state.resize_y;

    if(dy < 0) {
      return
    }

    const height = this.state.canvasHeight + dy

    this.addCanvasHeight(height)
  }

  addCanvasHeight(height) {
    let originalImage = this.state.canvasContext.getImageData(
      0,
      0,
      this.canvasRef.el.offsetWidth,
      this.canvasRef.el.offsetHeight
    );

    this.state.canvasHeight = height;
    this.canvasRef.el.height = height;
    this.overlayCanvasRef.el.height = height;
    this.backgroundTemplateRef.el.height = height;

    this.state.canvasContext.putImageData(originalImage, 0, 0);
  }

  mouseUpHandler() {
    this.generateActionHistory('resize', {
      'canvasHeight': this.canvasRef.el.offsetHeight
    })
    window.removeEventListener('mousemove', this.boundMouseMoveHandler);
    window.removeEventListener('mouseup', this.boundMouseUpHandler);
  }

  executeDeletions(deletions) {
    this.state.canvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
    let restoreStrokes = [];
    for (let i = this.state.allStrokes.length - 1; i >= 0; i--) {
      const stroke = this.state.allStrokes[i];
      for (const deletion of deletions) {
        if (stroke.id === deletion.id && stroke.user === deletion.user) {
          this.state.allStrokes[i].deleted = true;
          if (stroke.action === 'deleteOne') {
            restoreStrokes.push({id: stroke.params.localId, user: stroke.params.createdBy});
          }
        }
      }
      for (const restoreStroke of restoreStrokes) {
        if (stroke.id === restoreStroke.id && stroke.user === restoreStroke.user) {
          this.state.allStrokes[i].deleted = false;
        }
      }
      if (stroke.action === "clear" && !stroke.deleted) break;  // all actions before this are redundant
    }
    this.drawActionHistory();
  }

  /**
   * Draws all the actions in the action history
   */
  drawActionHistory(strokes = this.state.allStrokes, redraw = true) {
    let drawPath; // used to make an object that contains the path to be drawn from other clients
    const redrawStartIndex = redraw ? this.findRecentClearCanvasAction() : 0;
    for (let i = redrawStartIndex; i < strokes.length; i++) {
      const stroke = strokes[i];
      if (stroke.deleted) continue;
      const params = stroke.params;
      this.state.canvasContext.strokeStyle = params?.strokeColor || this.state.strokeColor;
      this.state.canvasContext.fillStyle = params?.strokeColor || this.state.strokeColor;
      this.state.canvasContext.lineWidth = params?.lineWidth || this.state.lineWidth;
      this.state.canvasContext.lineCap = "round";
      this.state.overlayCanvasContext.lineCap = "round";

      // Draw all actions on the canvas
      switch (stroke.action) {
        case "arc":
          let path = new Path2D();
          path.arc(params.initialCoordinates.x, params.initialCoordinates.y, params.radius, 0, 2 * Math.PI);
          this.state.canvasContext.fill(path);
          break;

        case "image":
          const image_ = new Image();
          image_.onload = () => {
            this.state.canvasContext.drawImage(image_, params.initialCoordinates.x, params.initialCoordinates.y, params.width, params.height);
          }
          image_.src = params.imgSrc;
          break;

        case "line":
        case "line-freehand":
        case "erase-freehand":
          if (this.state.mode === "erase" || this.state.isMousePressed) {
            this.state.canvasContext.stroke();
          }
          if (!drawPath) {
            drawPath = new Path2D();
            drawPath.lineCap = "round";
            drawPath.lineWidth = params.lineWidth;
            drawPath.moveTo(params.initialCoordinates.x, params.initialCoordinates.y);
          }
          drawPath.lineTo(params.currentCoordinates.x, params.currentCoordinates.y);
          drawPath.lineCap = "round";
          this.state.canvasContext.lineCap = "round";
          if (stroke.action === 'erase-freehand')
            this.state.canvasContext.globalCompositeOperation = 'destination-out'; // set to transparent erase
          this.state.canvasContext.stroke(drawPath);
          if (stroke.action === 'erase-freehand')
            this.state.canvasContext.globalCompositeOperation = 'source-over'; // set back to sketch
          // reset drawPath and canvas color
          drawPath = null;
          if (FREE_SKETCH_MODES.includes(this.state.mode) || this.state.isMousePressed) {
            const mouseCoordinates = {x: this.state.initialMouseCordinates.x, y: this.state.initialMouseCordinates.y};
            this.state.canvasContext.beginPath();
            this.state.canvasContext.moveTo(mouseCoordinates.x, mouseCoordinates.y);
          }
          break;

        case "template":
          const img = new Image();
          img.src = stroke.params.imgSrc;

          img.onload = () => {
            this.state.backgroundTemplateContext.drawImage(img,0,0);
          }
          break;

        case "text":
          this.state.canvasContext.font = params.font;
          this.state.canvasContext.fillText(params.text, params.initialCoordinates.x, params.initialCoordinates.y);
          break;

        case "clear":
          this.state.canvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
          break;

        case "point":
          this.state.canvasContext.beginPath();
          this.state.canvasContext.arc(params.currentCoordinates.x, params.currentCoordinates.y, params.lineWidth / 2, 0, 2 * Math.PI);
          this.state.canvasContext.closePath();
          this.state.canvasContext.fill();
          break;

        case "fillRect":
          this.state.canvasContext.fillRect(
            params.initialCoordinates.x,
            params.initialCoordinates.y,
            params.currentCoordinates.x - params.initialCoordinates.x,
            params.currentCoordinates.y - params.initialCoordinates.y
          );
          this.state.canvasContext.fill();
          break;

        case "actionGroupStart":
        case "actionGroupEnd":
        case "deleteOne":
        case "deleteMany":
          break;

        case 'resize':
          this.addCanvasHeight(params.canvasHeight);
          break;

        default:
          console.error("Invalid action: ", params.action)
          break;
      }
      this.state.canvasContext.fillStyle = this.state.strokeColor;
      this.state.canvasContext.strokeStyle = this.state.strokeColor;
      this.state.canvasContext.lineWidth = this.state.lineWidth;
    };
  }

  // use a throttled function to prevent the canvas from being redrawn too often
  throttledSyncActionHistory = _.throttle(() => {
    if (!this.state.actionHistory.length) return;
    this.orm.call(
      'knowledge_canvas.sketchpad_stroke_history',
      'publish_sketchpad_stroke_actions',
      [this.state.id], { 'sketchpad_id': this.state.id, 'stroke_actions': this.state.actionHistory }
    )
    const strokes = this.state.actionHistory.map(stroke => {
      return {
        sketchpad_seq_id: this.state.id,
        user_identifier: this.state.user,
        local_stroke_id: stroke.id,
        stroke: JSON.stringify(stroke)
      }
    });
    this.state.actionHistory = [];
  }, 100);

  /**
   * This function uses the mouse coordinate to iterate throught the action history and find the shape that was clicked on and also marks the
   * shape as deleted
   *
   * @param {Object} mouseCoordinates
   * @param {Boolean} shouldDelete
   *
   * @returns {String} id of the shape that was clicked on
   */
  findShape = (mouseCoordinates, shouldDelete) => {
    for (let i = this.state.allStrokes.length - 1; i >= 0; i--) {
      const actionParams = this.state.allStrokes[i].params;
      const actionLog = this.state.allStrokes[i];
      if (actionLog.deleted) continue;
      let shapeToDelete = false;
      switch (actionLog.action) {
        case "arc":
          // we used squared distance here for faster calculation
          const radiusSquared = actionParams.radius * actionParams.radius;
          const distance = this.squaredEucledianDistance(mouseCoordinates, actionParams.initialCoordinates);
          shapeToDelete = (distance <= radiusSquared);
          break;

        case "line":
          const slope = (actionParams.currentCoordinates.y - actionParams.initialCoordinates.y) / (actionParams.currentCoordinates.x - actionParams.initialCoordinates.x);
          const intercept = actionParams.initialCoordinates.y - slope * actionParams.initialCoordinates.x;
          const distanceToLine = Math.abs(slope * mouseCoordinates.x - mouseCoordinates.y + intercept) / Math.sqrt(Math.pow(slope, 2) + 1);
          shapeToDelete = (distanceToLine <= actionParams.lineWidth);
          break;

        case "fillRect":
          shapeToDelete = (mouseCoordinates.x >= actionParams.initialCoordinates.x &&
              mouseCoordinates.x <= actionParams.currentCoordinates.x &&
              mouseCoordinates.y >= actionParams.initialCoordinates.y &&
              mouseCoordinates.y <= actionParams.currentCoordinates.y);
          break;
      }
      if (shapeToDelete) {
        this.state.selectedShape = JSON.parse(JSON.stringify(actionLog)); // deep copy since we will be modifying the object's coordinates
        this.state.allStrokes[i].deleted = shouldDelete;
        return i;
      }
    }
    return this.state.selectedShape = null;
  }

  /**
   * Stops drawing the figure/sketching when the mouse focuses
   * out of the canvas
   *
   * @param {*} event
   */
  onMouseOut(ev) {
    if (!this.state.isMousePressed) return;
    if (this.state.drawingShape) this.onMouseUp(ev);
    if (FREE_SKETCH_MODES.includes(this.state.mode)) {
      this.generateActionHistory("actionGroupEnd");
    }
    if (this.state.selectedShape) {
      this.state.overlayCanvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
      this.state.selectedShape = null;
    }
    this.state.isMousePressed = false;
    this.state.initialMouseCordinates = {x: null, y: null};
  }

  /**
   * Touchend event doesnt capture the touch coordinates hence we need to track them here
   *
   * @param {*} event
   */
  onTouchMove(ev) {
    this.state.touchCoordinates = this.getMousePosition(ev);
    this.sketch(ev);
  }

  /**
   * Returns the Mouse Position
   *
   * @param {*} event
   * @returns {{ x: number; y: number; }}
   */
  getMousePosition(ev) {
    const canvasCoordinates = this.canvasRef.el.getBoundingClientRect();
    // check if the event is a touch event
    if (ev.touches) {
      if (ev.touches.length)
        return {
          x: parseInt(ev.touches[0].clientX - canvasCoordinates.left),
          y: parseInt(ev.touches[0].clientY - canvasCoordinates.top),
        };
      else return this.state.touchCoordinates;
    }
    return { x: parseInt(ev.clientX - canvasCoordinates.left), y: parseInt(ev.clientY - canvasCoordinates.top) };
  }

  async saveStrokes(action) {
    // Save canvas stroke history
    // this.orm.write("canvas.sketchpad", [this.state.id], { stroke_history: this.state.allStrokes });
    // await this.orm.create('knowledge_canvas.sketchpad_stroke_history', [{ sketchpad_seq_id: this.state.id, stroke: JSON.stringify(action) }]);
  }

  /**
   * Begins drawing on the canvas
   *
   * @param {*} event
   */
  onMouseDown(ev) {
    ev.preventDefault();
    if (this.canvasRef.el.offsetWidth != this.state.canvasWidth) {
      this.handleResize()
    }
    const mousePosition = this.getMousePosition(ev);
    this.state.isMousePressed = true;

    switch (this.state.mode) {
      case "text":
        if (this.drawTextInputRef.el.style.display === "block")
          this.drawTextInputRef.el.blur();
        this.state.initialMouseCordinates = mousePosition;
        Object.assign(this.drawTextInputRef.el.style, {
          display: "block",
          left: mousePosition.x + "px",
          top: mousePosition.y + "px",
        });
        this.drawTextInputRef.el.focus();
        break;
      case "shape":
        if (!this.state.initialMouseCordinates.x)
          this.state.initialMouseCordinates = mousePosition;
        break;
      case "sketch":
      case "image":
        this.state.initialMouseCordinates = mousePosition;
        break;
      case "erase":
        this.generateActionHistory("actionGroupStart")
        this.state.isMousePressed = true;
        this.state.initialMouseCordinates = mousePosition;
        break;
      case "select":
        this.generateActionHistory("actionGroupStart")
        this.state.selectedShape = null;
        this.state.initialMouseCordinates = mousePosition;
        this.findShape(mousePosition, true);
        if (this.state.selectedShape) {
          this.state.canvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
          this.drawActionHistory();
          this.highlightShape();
        }
        else {
          this.state.overlayCanvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
        }
        break;
      default:
        console.error("Invalid drawing mode");
    }
  }

  /**
   * Draws text on the canvas
   */
  onTextBlur(ev) {
    const text = ev.target.value;

    // Now, draw the text and set the font
    this.state.canvasContext.font = this.state.font;
    this.state.canvasContext.fillStyle = this.state.strokeColor;

    // Draw the text
    // If the text is too long, split it into multiple lines
    const lines = text.split("\n");
    const lineHeight = parseInt(this.state.font.split(" ")[0]) * 1.286;
    for (let i = 0; i < lines.length; i++) {
      this.state.canvasContext.fillText(lines[i], this.state.initialMouseCordinates.x, this.state.initialMouseCordinates.y + lineHeight * i);
    }

    this.drawTextInputRef.el.style.display = "none";
    this.drawTextInputRef.el.value = "";

    // Add to action history and sync with other users
    this.generateActionHistory("text", {
      initialCoordinates: this.state.initialMouseCordinates,
      text,
      font: this.state.font,
      strokeColor: this.state.strokeColor,
    });
  }

  /**
   * Ends drawing on the canvas
   *
   * @param {*} event
   */
  onMouseUp(ev) {
    ev.preventDefault(); // prevents the canvas from getting selected on touch devices
    if (FREE_SKETCH_MODES.includes(this.state.mode)) {
      this.generateActionHistory("actionGroupEnd")
    }
    this.state.isMousePressed = false;
    if (this.state.drawingShape && this.state.initialMouseCordinates)
      this.drawShapeEnd(ev);
    if (this.state.selectedShape) {
      const selectedShape = this.state.selectedShape;
      const mousePosition = this.getMousePosition(ev);
      this.translateShape(this.state.canvasContext, mousePosition);
      this.state.overlayCanvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
      // generate action history for the placed shape
      const dx = mousePosition.x - this.state.initialMouseCordinates.x;
      const dy = mousePosition.y - this.state.initialMouseCordinates.y;
      selectedShape.params.initialCoordinates.x += dx;
      selectedShape.params.initialCoordinates.y += dy;
      if (selectedShape.params.currentCoordinates) {
        selectedShape.params.currentCoordinates.x += dx;
        selectedShape.params.currentCoordinates.y += dy;
      }
      this.generateActionHistory("deleteOne", {
        localId: this.state.selectedShape.id,
        createdBy: this.state.selectedShape.user
      });
      // this.state.selectedShape.id = this._strokeId; // reset the id to the new id which will be drawn
      switch(selectedShape.action) {
        case "fillRect":
          this.generateActionHistory("fillRect", {
            currentCoordinates: selectedShape.params.currentCoordinates,
            initialCoordinates: selectedShape.params.initialCoordinates,
            strokeColor: selectedShape.params.strokeColor,
          });
          break;

        case "line":
          this.generateActionHistory("line", {
            currentCoordinates: selectedShape.params.currentCoordinates,
            initialCoordinates: selectedShape.params.initialCoordinates,
            strokeColor: selectedShape.params.strokeColor,
            lineWidth: selectedShape.params.lineWidth,
          });
          break;

        case "arc":
          this.generateActionHistory("arc", {
            initialCoordinates: selectedShape.params.initialCoordinates,
            radius: selectedShape.params.radius,
            strokeColor: selectedShape.params.strokeColor,
          });
          break;
      }
      this.highlightShape();
      this.generateActionHistory("actionGroupEnd")
    }
    // Add check for "text" mode before setting initialMouseCordinates to null.
    if (this.state.mode !== "text")
      this.state.initialMouseCordinates = { x: null, y: null };
  }

  /**
   * Paints a dot on clicking the canvas around the mouse position
   *
   * @param {*} event
   */
  sketchClick(ev) {
    ev.preventDefault(); // prevents the canvas from getting selected on touch devices
    if (this.state.disableClick) return;
    if (this.state.disableClick) return;
    let mousePosition = this.getMousePosition(ev);


    if (this.img || this.state.placingImage) {
      let scaleFactor = 1;

      // Grabbing the image's width & height, going to rescale if too large
      let width = this.img.width;
      let height = this.img.height;

      // Calculating scale factor, considering both width and height
      if (width > this.state.canvasWidth * 0.75) {
          scaleFactor = (this.state.canvasWidth * 0.75) / width;
      }
      if (height > this.state.canvasHeight * 0.75) {
          scaleFactor = Math.min(scaleFactor, (this.state.canvasHeight * 0.75) / height);
      }

      // Applying scale factor
      width *= scaleFactor;
      height *= scaleFactor;

      // Getting position to center the image
      const x = mousePosition.x - width / 2;
      const y = mousePosition.y - height / 2;

      // Drawing image
      this.state.canvasContext.drawImage(this.img, x, y, width, height);

      // Add to the actionHistory and sync with other users
      this.generateActionHistory("image", {
        imgSrc: this.img.src,
        width: width,
        height: height,
        initialCoordinates: { x: x, y: y },
      });

      this.img = null; // reset the img
      this.state.placingImage = false; // reset the placingImage flag
      return;
    }

    switch(this.state.mode) {
      case "select":
        break;
      case "erase":
      case "sketch":
        let path = new Path2D();
        path.arc(
          mousePosition.x,
          mousePosition.y,
          this.state.lineWidth / 2,
          0,
          2 * Math.PI
        );
        if (this.state.mode === "erase")
          this.state.canvasContext.globalCompositeOperation="destination-out"; // set to transparent erase mode
        else
          this.state.canvasContext.fillStyle = this.state.strokeColor;
        this.state.canvasContext.fill(path);
        this.generateActionHistory("point", {
          currentCoordinates: mousePosition,
          strokeColor: this.state.strokeColor,
          lineWidth: this.state.lineWidth,
         });
        break;
    }
  }

  /**
   * Sketches on the canvas by drawing a line from the previous mouse position to the current mouse position
   * We can't just simply draw a dot at the current mouse position because the mousemove event is not fired
   * fast enough to draw a smooth line.
   *
   * @param {*} event
   */
  sketch(ev) {
    ev.preventDefault(); // prevents the canvas from getting selected on touch devices
    if (this.state.mode === "text" || (this.state.mode === "select" && !this.state.isMousePressed)) return;
    if (this.state.isMousePressed) {
      this.state.disableClick = true;
      this.debouncedEnableClick();
      this.state.canvasContext.globalCompositeOperation="source-over"; // set to sketch mode
      const mousePosition = this.getMousePosition(ev);
      if (this.state.selectedShape) {
        this.state.overlayCanvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
        this.translateShape(this.state.overlayCanvasContext, mousePosition);
        return;
      }
      if (this.state.mode === "shape") {
        if (!this.state.initialMouseCordinates.x) {
          this.state.initialMouseCordinates = mousePosition;
        }

        // clear the overlay canvas
        this.state.overlayCanvasContext.clearRect(
          0,
          0,
          this.state.canvasWidth,
          this.state.canvasHeight
        );

        // Displays the preview of drawing these shapes on the overlay canvas
        switch (this.state.drawingShape) {
          case "rectangle":
            this.drawRectangle(mousePosition, this.state.overlayCanvasContext);
            break;
          case "line":
            this.drawLine(mousePosition, this.state.overlayCanvasContext);
            break;
          case "circle":
            this.drawCircle(mousePosition, this.state.overlayCanvasContext);
            break;
        }

        return;
      }

      // case: Free-hand drawing/erasing
      if (FREE_SKETCH_MODES.includes(this.state.mode)) {
        const path = new Path2D();
        path.moveTo(this.state.initialMouseCordinates.x, this.state.initialMouseCordinates.y);
        path.lineTo(mousePosition.x, mousePosition.y);

        if (this.state.mode === "erase")
        this.state.canvasContext.globalCompositeOperation="destination-out"; // set to transparent erase mode
        else
        this.state.canvasContext.strokeStyle = this.state.strokeColor;

        this.state.canvasContext.lineWidth = this.state.lineWidth;
        this.state.canvasContext.stroke(path);
        this.generateActionHistory(this.state.mode === "erase" ? "erase-freehand" : "line-freehand", {
          currentCoordinates: mousePosition,
          initialCoordinates: this.state.initialMouseCordinates,
          strokeColor: this.state.strokeColor,
          lineWidth: this.state.lineWidth,
         });
        this.state.initialMouseCordinates = mousePosition;
      }
    }
  }

  /**
   * Renders a preview of how the rectangle will look like on the overlay canvas
   *
   * @param {object} mousePosition : {x: number, y: number}
   * @param {object} canvasContext
   * @param {object} initialMouseCordinates : {x: number, y: number}
   * @param {string} strokeColor : hex value of the stroke color
   */
  drawRectangle(mousePosition, canvasContext, initialMouseCordinates = this.state.initialMouseCordinates, strokeColor = this.state.strokeColor) {
    canvasContext.beginPath();
    canvasContext.fillStyle = strokeColor;
    canvasContext.fillRect(
      initialMouseCordinates.x,
      initialMouseCordinates.y,
      mousePosition.x - initialMouseCordinates.x,
      mousePosition.y - initialMouseCordinates.y
    );
    canvasContext.fill();
  }

  /**
   * Renders a preview of how the line will look like on the overlay canvas
   *
   * @param {object} mousePosition : {x: number, y: number}
   * @param {object} canvasContext
   * @param {object} initialMouseCordinates : {x: number, y: number}
   * @param {number} lineWidth : width of the line
   * @param {string} strokeColor : hex value of the stroke color
   */
  drawLine(
    mousePosition,
    canvasContext,
    initialMouseCordinates = this.state.initialMouseCordinates,
    lineWidth = this.state.lineWidth,
    strokeColor = this.state.strokeColor) {
    let path = new Path2D();
    path.moveTo(initialMouseCordinates.x, initialMouseCordinates.y);
    path.lineTo(mousePosition.x, mousePosition.y);
    canvasContext.strokeStyle = strokeColor;
    canvasContext.lineWidth = lineWidth;
    canvasContext.stroke(path);
  }

  /**
   * Renders a preview of how the circle will look like on the overlay canvas
   *
   * @param {object} mousePosition
   */
  drawCircle(
    mousePosition,
    canvasContext,
    initialMouseCordinates = this.state.initialMouseCordinates,
    radius = null,
    strokeColor = this.state.strokeColor) {
    let path = new Path2D();
    path.arc(
      initialMouseCordinates.x,
      initialMouseCordinates.y,
      radius || Math.sqrt(this.squaredEucledianDistance(mousePosition, this.state.initialMouseCordinates)),
      0,
      2 * Math.PI
    );
    canvasContext.fillStyle = strokeColor;
    canvasContext.fill(path);
  }

  /**
   * Clears the canvas
   */
  clearCanvas() {
    this.state.isMousePressed = false;
    this.state.canvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
    this.state.actionHistory = [];
    this.state.allStrokes = [];
    this.state.selectedShape = null;
    this.generateActionHistory("clear");
    // save the template history since the previous stroke history contents are cleared for performance
    this.generateActionHistory("template", {
      imgSrc: this.backgroundTemplateRef.el.toDataURL("image/jpeg")
    });
  }

  /**
   * Save Image with a default white background if no template, or with template.
   * Takes drawings from Canvas layer and combines with Background layer to save full image, then resets both layers.
   */
  saveImage() {
    // set the ctx to draw beneath your current content
    this.state.canvasContext.globalCompositeOperation = "destination-over";

    // save the context of Background layer and Canvas layer
    const backgroundCtx = this.state.backgroundTemplateContext.getImageData(0,0, this.state.canvasWidth, this.state.canvasHeight);
    const canvasCtx = this.canvasRef.el;

    // combine Canvas and Background layer and save the image from background layer
    this.state.backgroundTemplateContext.drawImage(canvasCtx, 0, 0, this.state.canvasWidth, this.state.canvasHeight);
    const canvasData = this.backgroundTemplateRef.el.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = "image.png";
    link.href = canvasData;
    link.click();

    // Reset background template state to before the save
    this.state.backgroundTemplateContext.putImageData(backgroundCtx,0,0);
  }

  /**
   * Sets the drawing type to either erase or draw
   */
  setDrawMode(mode, shape) {
    this.state.mode = mode;
    this.state.drawingShape = shape;
    this.state.selectedShape = null;

    // set cursor based on mode
    switch(mode) {
      case "text":
        this.overlayCanvasRef.el.style.cursor = "text";
        break;
      case "shape":
        this.overlayCanvasRef.el.style.cursor = "crosshair";
        break;
      case "image":
        this.overlayCanvasRef.el.style.cursor = "crosshair";
        this.addImage('canvas');
        break;
      default:
        this.overlayCanvasRef.el.style.cursor = "default";
    }
  }

  /**
   * Returns the squared eucledian distance between two points. This is used in drawing arcs
   *
   * @param {object} start: {x: number, y: number}
   * @param {object} end: {x: number, y: number}
   *
   * @returns {number}
   */
  squaredEucledianDistance(start, end) {
    return Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2);
  }

  /**
   * Finish drawing a shape
   */
  drawShapeEnd(ev) {
    const mousePosition = this.getMousePosition(ev);
    if (!this.state.initialMouseCordinates.x) return;

    switch (this.state.drawingShape) {
      case "rectangle":
        this.drawRectangle(mousePosition, this.state.canvasContext);
        this.generateActionHistory("fillRect", {
          currentCoordinates: mousePosition,
          initialCoordinates: this.state.initialMouseCordinates,
          strokeColor: this.state.strokeColor
        });
        break;
      case "line":
        this.drawLine(mousePosition, this.state.canvasContext);
        this.generateActionHistory("line", {
          currentCoordinates: mousePosition,
          initialCoordinates: this.state.initialMouseCordinates,
          strokeColor: this.state.strokeColor,
          lineWidth: this.state.lineWidth
        });
        break;
      case "circle":
        this.drawCircle(mousePosition, this.state.canvasContext);
        this.generateActionHistory("arc", {
          initialCoordinates: this.state.initialMouseCordinates,
          radius: Math.sqrt(this.squaredEucledianDistance(mousePosition, this.state.initialMouseCordinates)),
          strokeColor: this.state.strokeColor
        });
        break;
    }

    this.state.overlayCanvasContext.clearRect(
      0,
      0,
      this.state.canvasWidth,
      this.state.canvasHeight
    );

    this.state.initialMouseCordinates = { x: null, y: null };
  }

  /**
   * Add image to canvas
   * @param {string} dest destination of where to add the image (canvas or background)
   */
  addImage(dest) {
    // Set mode to image if not already
    if (this.state.mode !== "image") {
      this.setDrawMode("image");
    }

    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", "image/*"); // to restrict to only image files

    input.onchange = event => {
        const file = event.target.files[0];

        if (!file) {
            throw new Error("No file selected!");
        }

        if (!file.type.startsWith("image/")) {
            throw new Error("Selected file is not an image!");
        }

        input.remove();

        dest != 'background' ? this.handleFile(file) : this.handleBackground(file);
    };

    // trigger the file select dialog
    input.click();
  }

  /**
   * Load image
   */
  loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result); // resolve on successful load
        reader.onerror = reject; // reject on error
        reader.readAsDataURL(file); // reads the data from the blob
    });
  }

  /**
   * Handle file
   */
  async handleFile(file) {
      const imgSrc = await this.loadImage(file);
      let img = new Image();

      img.onload = () => {
          // Create a sample canvas to draw the image on, for compression
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          // Maintain aspect ratio
          const MAX_WIDTH = 850;
          const scale = MAX_WIDTH / img.width;
          canvas.width = MAX_WIDTH;
          canvas.height = img.height * scale;

          // Draw image on the canvas (new one)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          // Compress the image
          const compressedImgSrc = canvas.toDataURL("image/jpeg", 0.7);
          this.img = new Image();
          this.img.src = compressedImgSrc;

          // Set placing image to true
          this.state.placingImage = true;
      }
      
      img.src = imgSrc;
  }

  /**
   * Undo the last action taken by current user
   *
   * @param {*} event
   */
  undo(user = this.state.user) {
    if (user === this.state.user) {
      this.state.overlayCanvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
      this.state.selectedShape = null;
    }
    let isFreeSketching = false, deletedActions = 0, lastActionIndex = this.state.allStrokes.length - 1;
    let params = {start: lastActionIndex, end: -1};
    while (lastActionIndex >= 0) {
      const currentAction = this.state.allStrokes[lastActionIndex];
      /*
      * We skip the following actions:
      * 1. Actions that were not performed by the current user
      * 2. Actions that were already deleted
      * 3. Actions that were logs of previous Undo (deleteMany) actions
      * 4. Actions that are not templates
      */
      if (currentAction.user === user && !currentAction.deleted && currentAction.action !== "deleteMany" && currentAction.action !== "template") {
        if (currentAction.action === "deleteOne") {
          const {createdBy, localId} = currentAction.params;
          params.restore = { createdBy, localId }
          for (let i = lastActionIndex; i >= 0; i--) {
            if (this.state.allStrokes[i].user === createdBy && this.state.allStrokes[i].id === localId) {
              this.state.allStrokes[i].deleted = false;
              break;
            }
          }
        }
        this.state.allStrokes[lastActionIndex].deleted = true;
        deletedActions++;
        // If the user is free sketching, undo all the free sketching actions (stored as multiple line actions)
        params.start = Math.min(params.start, lastActionIndex);
        params.end = Math.max(params.end, lastActionIndex);
        isFreeSketching |= (currentAction.action === "actionGroupEnd");      // true if user was free sketching
        isFreeSketching &= (currentAction.action !== "actionGroupStart");    // false when user started free sketching
        if (!isFreeSketching) {
          // In case of click, we record a mouseUp and mouseDown action before the click action so it creates a redundant action pair
          if (deletedActions !== 2)
            break;
          else {
            deletedActions = 0;
            params = {start: lastActionIndex, end: -1};
          }
        }
      }
      lastActionIndex--;
    }

    if (params.end !== -1) {
      this.state.canvasContext.beginPath();
      this.state.canvasContext.fill();  // This is to prevent the last action from being drawn again
      this.state.canvasContext.clearRect(0, 0, this.state.canvasWidth, this.state.canvasHeight);
      this.drawActionHistory();
      if (user === this.state.user) {
        params.createdBy = user;
        this.generateActionHistory("deleteMany", params);
      }
    }
  }


  /**
   * Highlight the shape that is selected in the state.selectedShape object by drawing it on the overlay canvas and adding a border
   *
   * @type {*}
   */
  highlightShape() {
    const selectedShape = this.state.selectedShape;
    if (!selectedShape) return;
    switch (selectedShape.action) {
      case "fillRect":
        const signX = Math.sign(selectedShape.params.currentCoordinates.x - selectedShape.params.initialCoordinates.x);
        const signY = Math.sign(selectedShape.params.currentCoordinates.y - selectedShape.params.initialCoordinates.y);
        this.drawRectangle(
          {x: selectedShape.params.currentCoordinates.x + signX * 5, y: selectedShape.params.currentCoordinates.y + signY * 5},
          this.state.overlayCanvasContext,
          {x: selectedShape.params.initialCoordinates.x - signX * 5, y: selectedShape.params.initialCoordinates.y - signY * 5},
          "#ACCEF7",
        );
        this.drawRectangle(
          selectedShape.params.currentCoordinates,
          this.state.overlayCanvasContext,
          selectedShape.params.initialCoordinates,
          selectedShape.params.strokeColor,
        );
        break;
      case "line":
        this.drawLine(
          selectedShape.params.currentCoordinates,
          this.state.overlayCanvasContext,
          selectedShape.params.initialCoordinates,
          selectedShape.params.lineWidth + 5,
          "#ACCEF7",
        );
        this.drawLine(
          selectedShape.params.currentCoordinates,
          this.state.overlayCanvasContext,
          selectedShape.params.initialCoordinates,
          selectedShape.params.lineWidth,
          selectedShape.params.strokeColor,
        );
        break;
      case "arc":
        this.drawCircle(
          null,
          this.state.overlayCanvasContext,
          selectedShape.params.initialCoordinates,
          selectedShape.params.radius + 5,
          "#ACCEF7",
        );
        this.drawCircle(
          null,
          this.state.overlayCanvasContext,
          selectedShape.params.initialCoordinates,
          selectedShape.params.radius,
          selectedShape.params.strokeColor,
        );
        break;
    }
  }

  /**
   * Translate the shape that is selected in the state.selectedShape object on the canvas
   *
   * @param {Object} canvasContext
   * @param {Object} mousePosition
  */
  translateShape(canvasContext, mousePosition) {
    const selectedShape = this.state.selectedShape;
    const dx = mousePosition.x - this.state.initialMouseCordinates.x;
    const dy = mousePosition.y - this.state.initialMouseCordinates.y;
    switch(selectedShape.action) {
      case "fillRect":
        // translate overlay canvas by the distance between current mouse coordinates and the initial mouse coordinates
        this.drawRectangle(
          {x: selectedShape.params.currentCoordinates.x + dx, y: selectedShape.params.currentCoordinates.y + dy},
          canvasContext,
          {x: selectedShape.params.initialCoordinates.x + dx, y: selectedShape.params.initialCoordinates.y + dy},
          selectedShape.params.strokeColor,
        );
        break;

      case "line":
        this.drawLine(
          {x: selectedShape.params.currentCoordinates.x + dx, y: selectedShape.params.currentCoordinates.y + dy},
          canvasContext,
          {x: selectedShape.params.initialCoordinates.x + dx, y: selectedShape.params.initialCoordinates.y + dy},
          selectedShape.params.lineWidth,
          selectedShape.params.strokeColor,
        );
        break;

      case "arc":
        this.drawCircle(
          null,
          canvasContext,
          {x: selectedShape.params.initialCoordinates.x + dx, y: selectedShape.params.initialCoordinates.y + dy},
          selectedShape.params.radius,
          selectedShape.params.strokeColor,
        );
        break;

    }
  }
}

Sketchpad.template = "odoo_canvas.sketchpad";
Sketchpad.components = { SketchTools };
Sketchpad.props = {
    ...AbstractBehavior.props,
    sketchpadId: {
      type: String,
      optional: false,
    }
};