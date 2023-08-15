export default class CollaborativeChannel {
    /**
     * @param {Env} env
     * @param {string} resModel
     * @param {number} resId
     */
    constructor(env, resModel, resId) {
        this.env = env;
        this.resId = resId;
        this.resModel = resModel;
        
        this._listener;
        
        this._queue = [];
        this._channel = `page_collaborative_session:${this.resModel}:${this.resId}`;
        this.env.services.bus_service.addChannel(this._channel);
        this.env.services.bus_service.addEventListener('notification', ({ detail: notifs }) =>
            this._handleNotifications(this._filterPageNotifs(notifs))
        );
    }

    onNewMessage(id, callback) {
        this._listener = callback;
        for (let message of this._queue) {
            callback(message);
        }
        this._queue = [];
    }

    sendMessage(message) {
        return this.env.services.rpc({
            model: this.resModel,
            method: "dispatch_page_message",
            args: [this.resId, message],
        }, { shadow: true });
    }

    leave() {
        this._listener = undefined;
    }

    _filterPageNotifs(notifs) {
        return notifs.filter((notification) => {
            const { payload, type } = notification;
            return payload.id === this.resId;
        });
    }

    _handleNotifications(notifs) {
        for (const { payload } of notifs) {
            if (!this._listener) {
                this._queue.push(payload);
            } else {
                this._listener(payload);
            }
        }
    }
}
