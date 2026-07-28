import { getIsConversationEmpty } from "metabase/metabot/state";
import type { MetabotSlashCommandHandler } from "metabase/plugins/oss/audit";
import { addUndo } from "metabase/redux/undo";
import { push } from "metabase/router";
import { getUserIsAdmin } from "metabase/selectors/user";

import * as EnterpriseUrls from "../../urls";

export const handleMetabotSlashCommand: MetabotSlashCommandHandler = ({
  command,
  conversationId,
  dispatch,
  getState,
}) => {
  if (command.cmd !== "inspect") {
    return false;
  }
  if (!getUserIsAdmin(getState())) {
    dispatch(addUndo({ message: "Unknown command" }));
    return true;
  }
  if (getIsConversationEmpty(getState(), conversationId)) {
    dispatch(addUndo({ message: "No message history to inspect" }));
    return true;
  }
  dispatch(
    push(EnterpriseUrls.adminMetabotUsageAuditingConversation(conversationId)),
  );
  return true;
};
