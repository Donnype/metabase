import { useState } from "react";
import { t } from "ttag";

import { canDownloadResults } from "metabase/common/utils/dataset";
import { getFirstQueryResult } from "metabase/query_builder/selectors";
import { useSelector } from "metabase/redux";
import { ActionIcon, Flex, Icon, Tooltip } from "metabase/ui";
import type Question from "metabase-lib/v1/Question";
import type { Dataset } from "metabase-types/api";

import { getCopyMode, useCopyResults } from "./use-copy-results";
import { useRenderedQuestion } from "./use-rendered-question";

export const ViewFooterCopyWidget = () => {
  const question = useRenderedQuestion();
  const result = useSelector(getFirstQueryResult);

  return (
    question &&
    result && <CopyResultsButton question={question} result={result} />
  );
};

interface CopyResultsButtonProps {
  question: Question;
  result: Dataset;
}

const CopyResultsButton = ({ question, result }: CopyResultsButtonProps) => {
  const [copying, setCopying] = useState(false);
  const copyResults = useCopyResults({ question, result });

  const label =
    getCopyMode(question) === "results"
      ? t`Copy these results to clipboard`
      : t`Copy this chart to clipboard`;

  const handleCopy = async () => {
    setCopying(true);

    try {
      await copyResults();
    } finally {
      setCopying(false);
    }
  };

  return (
    <Flex visibleFrom="sm">
      <Tooltip label={label}>
        <ActionIcon
          data-testid="question-results-copy-button"
          onClick={handleCopy}
          aria-label={label}
          loading={copying}
          variant="viewFooter"
        >
          <Icon name="clipboard" />
        </ActionIcon>
      </Tooltip>
    </Flex>
  );
};

ViewFooterCopyWidget.shouldRender = ({ result }: { result?: Dataset | null }) =>
  result != null && canDownloadResults(result);
