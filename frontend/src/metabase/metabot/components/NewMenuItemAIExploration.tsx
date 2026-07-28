import { t } from "ttag";

import { ForwardRefLink } from "metabase/common/components/Link";
import { Icon, Menu } from "metabase/ui";
import * as Urls from "metabase/urls";
import type { CollectionId } from "metabase-types/api";

interface NewMenuItemAIExplorationProps {
  collectionId?: CollectionId;
}

export function NewMenuItemAIExploration({
  collectionId,
}: NewMenuItemAIExplorationProps) {
  return (
    <Menu.Item
      component={ForwardRefLink}
      to={Urls.newQuestion({
        mode: "ask",
        collectionId,
        cardType: "question",
      })}
      leftSection={<Icon name="comment" />}
    >
      {t`AI exploration`}
    </Menu.Item>
  );
}
