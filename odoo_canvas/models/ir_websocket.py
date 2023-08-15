# Part of Odoo. See LICENSE file for full copyright and licensing details.

import re

from odoo import models

class IrWebsocket(models.AbstractModel):
    _inherit = 'ir.websocket'

    def _build_bus_channel_list(self, channels):
        if self.env.uid:
            channels = self._add_page_collaborative_bus_channels(channels)
        return super()._build_bus_channel_list(channels)

    def _add_page_collaborative_bus_channels(self, channels):
        channels = list(channels)
        for channel in channels:
            if not isinstance(channel, str):
                continue
            match = re.match(r'page_collaborative_session:(\w+(?:\.\w+)*):(\d+)', channel)
            if match:
                model_name = match[1]
                res_id = int(match[2])
                if model_name not in self.env:
                    continue
                record = self.env[model_name].with_context(active_test=False).search([("id", "=", res_id)])
                channels.append(record)
        return channels
