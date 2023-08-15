import json
import logging
import base64
import psycopg2


from datetime import timedelta
from typing import Dict, Any, List

from odoo import fields, models
from odoo.exceptions import AccessError
from odoo.tools import mute_logger

_logger = logging.getLogger(__name__)

CollaborationMessage = Dict[str, Any]

class PagesCollaboration(models.AbstractModel):
    _name = "page.collaboration"
    _description = "Collaboration on pages for Canvas"

    raw = fields.Binary()
    page_snapshot = fields.Binary()
    page_revision_ids = fields.One2many(
        "page.revision",
        "res_id",
        domain=lambda self: [('res_model', '=', self._name)],
        groups="base.group_system",
    )

    def join_page_session(self):
        self.ensure_one()
        self._check_collaborative_page_access("read")
        can_write = self._check_collaborative_page_access(
            "write", raise_exception=False
        )
        return {
            "id": self.id,
            "name": self.display_name,
            "raw": self._get_page_snapshot(),
            "revisions": self.sudo()._build_page_messages(),
            "snapshot_requested": can_write and self._should_be_snapshotted(),
            "isReadonly": not can_write,
        }

    def dispatch_page_message(self, message: CollaborationMessage):
        self.ensure_one()

        if message["type"] in ["REMOTE_REVISION", "REVISION_UNDONE", "REVISION_REDONE"]:
            self._check_collaborative_page_access("write")
            is_accepted = self._save_concurrent_revision(
                message["nextRevisionId"],
                message["serverRevisionId"],
                self._build_page_revision_data(message),
            )
            if is_accepted:
                self._broadcast_page_message(message)
            return is_accepted
        elif message["type"] == "SNAPSHOT":
            return self._snapshot_page(
                message["serverRevisionId"], message["nextRevisionId"], message["data"]
            )
        elif message["type"] in ["CLIENT_JOINED", "CLIENT_LEFT", "CLIENT_MOVED"]:
            self._check_collaborative_page_access("read")
            self._broadcast_page_message(message)
            return True
        return False

    def _snapshot_page(
        self, revision_id: str, snapshot_revision_id, page_snapshot: dict
    ):
        is_accepted = self._save_concurrent_revision(
            snapshot_revision_id,
            revision_id,
            {"type": "SNAPSHOT_CREATED", "version": 1},
        )
        if is_accepted:
            self.page_snapshot = base64.encodebytes(
                json.dumps(page_snapshot).encode("utf-8")
            )
            self._delete_page_revisions()
            self._broadcast_page_message(
                {
                    "type": "SNAPSHOT_CREATED",
                    "serverRevisionId": revision_id,
                    "nextRevisionId": snapshot_revision_id,
                }
            )
        return is_accepted

    def _get_page_snapshot(self):
        if not self.page_snapshot:
            self.sudo().page_snapshot = base64.encodebytes(self.raw)
        return base64.decodebytes(self.page_snapshot)

    def _should_be_snapshotted(self):
        if not self.page_revision_ids:
            return False
        last_activity = max(self.page_revision_ids.mapped("create_date"))
        return last_activity < fields.Datetime.now() - timedelta(hours=12)

    def _save_concurrent_revision(self, next_revision_id, parent_revision_id, commands):
        self.ensure_one()
        self._check_collaborative_page_access("write")
        try:
            with mute_logger("odoo.sql_db"):
                self.env["page.revision"].sudo().create(
                    {
                        "res_model": self._name,
                        "res_id": self.id,
                        "commands": json.dumps(commands),
                        "parent_revision_id": parent_revision_id,
                        "revision_id": next_revision_id,
                        "create_date": fields.Datetime.now(),
                    }
                )
            return True
        except psycopg2.IntegrityError:
            _logger.info("Wrong base page revision on %s", self)
            return False

    def _build_page_revision_data(self, message: CollaborationMessage) -> dict:
        message = dict(message)
        message.pop("serverRevisionId", None)
        message.pop("nextRevisionId", None)
        message.pop("clientId", None)
        return message

    def _build_page_messages(self) -> List[CollaborationMessage]:
        self.ensure_one()
        return [
            dict(
                json.loads(rev.commands),
                serverRevisionId=rev.parent_revision_id,
                nextRevisionId=rev.revision_id,
            )
            for rev in self.page_revision_ids
        ]

    def _check_collaborative_page_access(
        self, operation: str, *, raise_exception=True
    ):
        try:
            self.check_access_rights(operation)
            self.check_access_rule(operation)
        except AccessError as e:
            if raise_exception:
                raise e
            return False
        return True

    def _broadcast_page_message(self, message: CollaborationMessage):
        self.ensure_one()
        self.env["bus.bus"]._sendone(self, "page", dict(message, id=self.id))

    def _delete_page_revisions(self):
        self.ensure_one()
        self._check_collaborative_page_access("write")
        self.sudo().page_revision_ids.active = False

    def _delete_collaborative_data(self):
        self.page_snapshot = False
        self.with_context(active_test=False).page_revision_ids.unlink()

    def unlink(self):
        if not self:
            return True
        self.sudo().with_context(active_test=False).page_revision_ids.unlink()
        return super().unlink()
