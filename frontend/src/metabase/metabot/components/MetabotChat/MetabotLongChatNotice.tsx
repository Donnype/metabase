import { c, jt } from "ttag";

import { Text, UnstyledButton } from "metabase/ui";

interface MetabotLongChatNoticeProps {
  onNewConversation: () => void;
}

export const MetabotLongChatNotice = ({
  onNewConversation,
}: MetabotLongChatNoticeProps) => (
  <Text lh={1} c="text-disabled" m={0} ta="center">
    {jt`This chat is getting long. You can ${(
      <UnstyledButton
        key="new-conversation"
        data-testid="metabot-long-chat-new-conversation"
        display="inline"
        c="core-brand"
        td="underline"
        onClick={onNewConversation}
      >{c("'it' refers to a chat with an AI agent")
        .t`clear it`}</UnstyledButton>
    )}.`}
  </Text>
);
