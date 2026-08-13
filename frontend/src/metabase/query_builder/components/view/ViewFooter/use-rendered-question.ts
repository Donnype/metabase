import { useMemo } from "react";

import { getQuestion, getRawSeries } from "metabase/query_builder/selectors";
import { useSelector } from "metabase/redux";

export const useRenderedQuestion = () => {
  const question = useSelector(getQuestion);
  const rawSeries = useSelector(getRawSeries);

  return useMemo(() => {
    const renderedCard = rawSeries?.[0]?.card;
    return question != null && renderedCard != null
      ? question.setCard(renderedCard)
      : question;
  }, [question, rawSeries]);
};
