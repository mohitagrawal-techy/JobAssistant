import { useMutation, useQueryClient } from "@tanstack/react-query";

import { send } from "../api/client";
import type { Stage } from "../api/types";
import { STAGES } from "../api/types";
import { ErrorText, inputClass } from "./ui";

export function StageControl({
  jobId,
  applicationId,
  name,
  stage,
  onMoved,
}: {
  jobId: string;
  applicationId: string;
  name: string;
  stage: Stage;
  onMoved?: (stage: Stage) => void;
}) {
  const client = useQueryClient();
  const move = useMutation({
    mutationFn: (next: Stage) => send("PATCH", `/org/applications/${applicationId}`, { stage: next }),
    onSuccess: (_data, next) => {
      client.invalidateQueries({ queryKey: ["analytics", jobId] });
      client.invalidateQueries({ queryKey: ["pipeline", jobId] });
      onMoved?.(next);
    },
  });
  return (
    <div>
      <select
        aria-label={`Move ${name} to stage`}
        className={`${inputClass} !mt-0 !w-auto !py-1 capitalize`}
        value={stage}
        disabled={move.isPending}
        onChange={(event) => move.mutate(event.target.value as Stage)}
      >
        {STAGES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ErrorText error={move.error} />
    </div>
  );
}
