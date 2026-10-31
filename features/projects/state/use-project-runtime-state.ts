import { useRef, useState } from 'react';

export function useProjectRuntimeState(projectPath?: string) {

  const [activeProjectPath, setActiveProjectPath] = useState<string | undefined>(projectPath);

  const activeProjectPathRef = useRef(activeProjectPath);

  const projectFileRequestRef = useRef(0);
  return { activeProjectPath, setActiveProjectPath, activeProjectPathRef, projectFileRequestRef };
}
