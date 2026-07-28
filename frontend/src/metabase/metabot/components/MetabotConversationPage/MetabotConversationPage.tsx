import { useEffect } from "react";
import { t } from "ttag";

import { skipToken } from "metabase/api";
import { useGetMetabotConversationQuery } from "metabase/api/metabot";
import { GenericError } from "metabase/common/components/ErrorPages";
import { MetabotAsk } from "metabase/metabot/components/MetabotAsk";
import {
  useMetabotPageConversation,
  useUserMetabotPermissions,
} from "metabase/metabot/hooks";
import {
  getIsConversationEmpty,
  getIsConversationInProgress,
  setConversationSnapshot,
} from "metabase/metabot/state";
import { normalizeFetchedChatMessages } from "metabase/metabot/utils/normalize-fetched-chat-messages";
import { useDispatch, useSelector } from "metabase/redux";
import { Navigate, useParams } from "metabase/router";
import { getSettingsLoading } from "metabase/selectors/settings";
import { Center, Loader } from "metabase/ui";
import * as Urls from "metabase/urls";

export const IN_PROGRESS_POLL_MS = 2500;

export const MetabotConversationPage = () => {
  const { convoId: urlConvoId } = useParams<{ convoId: string }>();
  const dispatch = useDispatch();
  const { canUseMetabot, isLoading } = useUserMetabotPermissions();
  const conversationId = useMetabotPageConversation(urlConvoId);

  const isSettingsLoading = useSelector(getSettingsLoading);
  const isInProgress = useSelector((state) =>
    conversationId ? getIsConversationInProgress(state, conversationId) : false,
  );
  const isEmpty = useSelector((state) =>
    conversationId ? getIsConversationEmpty(state, conversationId) : true,
  );

  const { currentData: conversation, isError } = useGetMetabotConversationQuery(
    !urlConvoId || !canUseMetabot || (!isEmpty && !isInProgress)
      ? skipToken
      : urlConvoId,
    {
      pollingInterval: isInProgress ? IN_PROGRESS_POLL_MS : 0,
    },
  );

  useEffect(
    function syncUrlConvoToStore() {
      if (!conversation) {
        return;
      }

      dispatch(
        setConversationSnapshot({
          conversationId: conversation.conversation_id,
          title: conversation.title ?? undefined,
          messages: normalizeFetchedChatMessages(conversation.messages),
          state: conversation.state,
          activeToolCalls: [],
        }),
      );
    },
    [conversation, dispatch],
  );

  if (isSettingsLoading || isLoading) {
    return <ConversationLoader />;
  }

  if (!canUseMetabot || !urlConvoId) {
    return <Navigate to={Urls.newQuestion({ mode: "ask" })} replace />;
  }

  if (isError) {
    return <ConversationLoadError />;
  }

  if (!conversationId || isEmpty) {
    return <ConversationLoader />;
  }

  return <MetabotAsk conversationId={conversationId} />;
};

const ConversationLoader = () => (
  <Center
    h="100%"
    w="100%"
    bg="background_page-primary"
    data-testid="metabot-conversation-loading"
  >
    <Loader size="lg" />
  </Center>
);

const ConversationLoadError = () => (
  <GenericError
    title={t`Unable to load this conversation`}
    message={t`Try refreshing the page.`}
    details={undefined}
  />
);
