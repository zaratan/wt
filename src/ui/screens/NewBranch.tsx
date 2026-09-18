import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { Footer } from "../Footer.js";
import { slugify } from "../../lib/git/slug.js";

export type NewBranchProps = {
  repoName: string;
  onSubmit: (branch: string) => void;
  onCancel: () => void;
};

export const NewBranch = ({
  repoName,
  onSubmit,
  onCancel,
}: NewBranchProps): React.JSX.Element => {
  const [branch, setBranch] = useState("");
  const slug = slugify(branch);
  const bad = branch !== "" && slug.kind === "error";

  // ink-text-input owns ←/→ for its cursor, so escape is the only way out.
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text>
        New worktree in <Text bold>{repoName}</Text>
      </Text>

      <Box marginTop={1}>
        <Text>{"  branch  "}</Text>
        <TextInput
          value={branch}
          onChange={setBranch}
          onSubmit={() => {
            if (branch.trim() !== "" && !bad) onSubmit(branch.trim());
          }}
          placeholder="feature/name"
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {bad
            ? "  that name has no usable directory form"
            : slug.kind === "ok" && branch !== ""
              ? `  directory  ${repoName}-${slug.slug}`
              : "  it is created from the default base unless it exists already"}
        </Text>
      </Box>

      <Footer
        hints={[
          { key: "enter", label: "create" },
          { key: "esc", label: "cancel" },
        ]}
      />
    </Box>
  );
};
