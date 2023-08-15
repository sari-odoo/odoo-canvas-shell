/** @odoo-module **/
const { Component, useState, onWillUnmount } = owl;


/* 
* This is the old toolbar component. Not currently implemented anywhere but will be refactored later to be a reusable toolbar between components. 
*/
export class Toolbar extends Component {
    setup() {
        this.state = useState({
            selected: "",
        });
        onWillUnmount(() => {
            document.body.style.cursor = "";
        }); 
    }

    //when user clicks on tool, change tool to that
    selectedTool(tool){
        this.state.selected = tool;
        console.log(this.state.selected + " selected!");
        document.body.style.cursor = tool === 'text' ? 'text' : tool === 'erase' ? 'no-drop' : 'default';
    }
}

Toolbar.template = 'toolbar'
