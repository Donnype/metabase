import { isFulfilled } from "@reduxjs/toolkit";
import { useCallback, useState } from "react";
import { useMount } from "react-use";

import { useMetabotContext } from "metabase/metabot";
import { useDispatch, useSelector } from "metabase/redux";
import { uuid } from "metabase/utils/uuid";

import { trackMetabotRequestSent } from "../analytics";
import type { MetabotProfileId } from "../constants";
import {
  type MetabotPromptSubmissionResult,
  type MetabotUserChatMessage,
  cancelInflightConversationRequests,
  ensureConversation,
  fetchConversationSnapshot,
  getActiveToolCalls,
  getConversationTitle,
  getDebugMode,
  getHasConversation,
  getIsConversationProcessing,
  getIsLongConversation,
  getMessages,
  getMetabotId,
  getMetabotReactionsState,
  getMetabotRequestId,
  getProfile,
  retryPrompt,
  setProfileOverride as setProfileOverrideAction,
  submitInput as submitInputAction,
} from "../state";

export type SubmitInputOptions = {
  profile?: MetabotProfileId | undefined;
  focusInput?: boolean;
  onBeforeSubmit?: () => void;
};

/**
 * Drive a conversation by id rather than through a surface. Two surfaces showing the same
 * conversation observe one record, so neither can fall behind the other.
 */
export const useMetabotConversation = (conversationId: string) => {
  const dispatch = useDispatch();
  const { prompt, setPrompt, promptInputRef, getChatContext } =
    useMetabotContext();

  const metabotRequestId = useSelector((state) =>
    getMetabotRequestId(state, conversationId),
  );

  const prepareRetryIfUnsuccesful = useCallback(
    (result: MetabotPromptSubmissionResult) => {
      if (!result.success && result.shouldRetry) {
        promptInputRef?.current?.focus();
        setPrompt(result.prompt);
      }
    },
    [promptInputRef, setPrompt],
  );

  const setProfileOverride = useCallback(
    (profile: MetabotProfileId | undefined) => {
      dispatch(setProfileOverrideAction({ conversationId, profile }));
    },
    [dispatch, conversationId],
  );

  const submitInput = useCallback(
    async (
      prompt: string | Omit<MetabotUserChatMessage, "id" | "role">,
      options?: SubmitInputOptions,
    ) => {
      setPrompt("");
      options?.onBeforeSubmit?.();

      if (options?.focusInput) {
        promptInputRef?.current?.focus();
      }

      const action = await dispatch(
        submitInputAction({
          ...(typeof prompt === "string"
            ? { type: "text", message: prompt }
            : prompt),
          context: await getChatContext(),
          conversationId,
          metabot_id: metabotRequestId,
          profile: options?.profile,
        }),
      );

      trackMetabotRequestSent();

      if (isFulfilled(action)) {
        prepareRetryIfUnsuccesful(action.payload);
      }

      return action;
    },
    [
      dispatch,
      getChatContext,
      metabotRequestId,
      prepareRetryIfUnsuccesful,
      conversationId,
      promptInputRef,
      setPrompt,
    ],
  );

  const retryMessage = useCallback(
    async (messageId: string) => {
      const context = await getChatContext();
      const action = await dispatch(
        retryPrompt({
          messageId,
          context,
          metabot_id: metabotRequestId,
          conversationId,
        }),
      );
      if (isFulfilled(action)) {
        prepareRetryIfUnsuccesful(action.payload);
      }
    },
    [
      dispatch,
      getChatContext,
      metabotRequestId,
      prepareRetryIfUnsuccesful,
      conversationId,
    ],
  );

  const cancelRequest = useCallback(() => {
    dispatch(cancelInflightConversationRequests(conversationId));
  }, [dispatch, conversationId]);

  const reloadConversation = useCallback(() => {
    dispatch(fetchConversationSnapshot(conversationId));
  }, [dispatch, conversationId]);

  return {
    conversationId,
    prompt,
    setPrompt,
    promptInputRef,
    setProfileOverride,
    submitInput,
    retryMessage,
    cancelRequest,
    reloadConversation,
    metabotId: useSelector(getMetabotId),
    profile: useSelector((state) => getProfile(state, conversationId)),
    title: useSelector((state) => getConversationTitle(state, conversationId)),
    messages: useSelector((state) => getMessages(state, conversationId)),
    isDoingScience: useSelector((state) =>
      getIsConversationProcessing(state, conversationId),
    ),
    isLongConversation: useSelector((state) =>
      getIsLongConversation(state, conversationId),
    ),
    activeToolCalls: useSelector((state) =>
      getActiveToolCalls(state, conversationId),
    ),
    debugMode: useSelector(getDebugMode),
    reactions: useSelector(getMetabotReactionsState),
  };
};

/**
 * Open a conversation record for a surface with no agent behind it. Pass the id from the
 * URL to resume one, or omit it to start a new conversation on mount. Returns undefined
 * until the record exists, since the conversation selectors require one.
 */
export const useMetabotPageConversation = (conversationId?: string) => {
  const dispatch = useDispatch();
  const [newConversationId] = useState(uuid);
  const id = conversationId ?? newConversationId;

  useMount(() => {
    dispatch(ensureConversation({ conversationId: id }));
  });

  return useSelector((state) => getHasConversation(state, id)) ? id : undefined;
};
