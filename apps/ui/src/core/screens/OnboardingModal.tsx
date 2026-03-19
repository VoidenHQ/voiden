import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/core/components/ui/dialog";
import { Button } from "@/core/components/ui/button";
import { Checkbox } from "@/core/components/ui/checkbox";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { cn } from "@/core/lib/utils";
import { useSettings } from "@/core/settings/hooks/useSettings";

import img1 from "@/assets/log.png";
import img2 from "@/assets/command.gif";
import img3 from "@/assets/getUser.gif";
import img4 from "@/assets/terminal-img.gif";

interface OnboardingStep {
  title: string;
  img: string;
  graphic: string;
  copy: string;
}

const steps: OnboardingStep[] = [
  {
    title: "Git-native. Markdown files. 100% local.",
    img: img1,
    graphic: "A file system tree with .md files, Git log next to it, and no cloud icons in sight.",
    copy: "Voiden works like your code editor because it is one. Every request, response, and doc is just Markdown. Fully local. Versioned with Git. No sync buttons. No hidden formats. No vendor lock-in. It's your API workspace, in your repo.",
  },
  {
    title: "Everything is a Slash Command",
    img: img2,
    graphic: "A command palette with /request, /doc, /test, /mock, /env being typed into a rich text area.",
    copy: "One editor. One surface. Infinite blocks. Type /request to define an API call. Add /doc for contextual documentation. Mix in /test, /env, or /mock. All in one place. No tab switching. No scattered UIs. Just type.",
  },
  {
    title: "Reuse Anything with @",
    img: img3,
    graphic: "Markdown with @getUser reused in multiple places, showing auto-complete and reference tracking.",
    copy: "Voiden is built for reusability. Reference any block with @. Use the same request in 10 places. Change it once. Cross-link docs, mocks, and tests like code.",
  },
  {
    title: "The One Editor That Does It All",
    img: img4,
    graphic: "A terminal where a user pastes a curl, hits enter, and a structured request appears; openAPI and Postman imports on the side.",
    copy: "Voiden speaks fluent API. Paste a curl and it converts it. Import OpenAPI or Postman files. Create everything from one clean editor.",
  },
];

export default function OnboardingModal() {
  const queryClient = useQueryClient();
  const { settings, loading, saveImmediate } = useSettings();
  const [currentStep, setCurrentStep] = useState(0);
  const [isOpen, setIsOpen] = useState(true);
  const [showSlides, setShowSlides] = useState(false);
  const [directory, setDirectory] = useState("");
  const [useSampleProject, setUseSampleProject] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && settings?.projects?.default_directory) {
      setDirectory(settings.projects.default_directory);
    }
  }, [loading, settings?.projects?.default_directory]);

  const handleBrowseDirectory = async () => {
    const [selectedPath] = (await window.electron?.dialog.openFile({
      defaultPath: directory || settings?.projects?.default_directory,
      properties: ["openDirectory", "createDirectory"],
    })) ?? [];

    if (selectedPath) {
      setDirectory(selectedPath);
      setError(null);
    }
  };

  const handleStart = async () => {
    const trimmedDirectory = directory.trim();
    if (!trimmedDirectory) {
      setError("Choose a project directory before continuing.");
      return;
    }

    const trimmedProjectName = projectName.trim();
    setIsStarting(true);
    setError(null);

    try {
      await saveImmediate({
        projects: {
          default_directory: trimmedDirectory,
        },
      });

      const result = await window.electron?.files.bootstrapProject(
        trimmedDirectory,
        useSampleProject,
        useSampleProject ? undefined : trimmedProjectName || "my-project",
      );

      if (!result?.projectPath || typeof result.projectPath !== "string" || result.projectPath.trim() === "") {
        throw new Error("Failed to prepare the selected project directory.");
      }

      await window.electron?.state.setActiveProject(result.projectPath);

      if (result.welcomeFile) {
        const tab = {
          id: crypto.randomUUID(),
          type: "document",
          title: result.welcomeFile.split(/[\\/]/).pop() || "hello.void",
          source: result.welcomeFile,
          directory: result.projectPath,
        };
        const panelResult = await window.electron?.state.addPanelTab("main", tab);
        await window.electron?.state.activatePanelTab("main", panelResult?.tabId || tab.id);
      }

      // Mark onboarding complete before invalidating app:state so the refetch
      // returns onboarding=true and the modal is not re-shown from scratch.
      await window.electron?.state.updateOnboarding(true);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["app:state"] }),
        queryClient.invalidateQueries({ queryKey: ["files:tree"] }),
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false }),
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false }),
      ]);

      setShowSlides(true);
      setCurrentStep(0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to start onboarding.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleFinish = () => {
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-40" />}
      <DialogContent
        className="max-w-[1150px] h-[550px] p-4 bg-[#0c0f1a] border-0 shadow-[0_0_10px_1px_#48cfff] overflow-hidden"
        style={{ width: "95%" }}
        datatype="no-close"
      >
        <VisuallyHidden>
          <DialogTitle>Voiden Onboarding</DialogTitle>
          <DialogDescription>Set your project directory and learn Voiden's key features.</DialogDescription>
        </VisuallyHidden>

        {!showSlides ? (
          <div className="h-full flex flex-col gap-6 p-8 text-white">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-[#48cfff]">Project Setup</p>
                  <h2 className="text-4xl font-medium bg-gradient-to-r from-[#48cfff] to-[#b36dff] bg-clip-text text-transparent">
                    Choose where Voiden should start.
                  </h2>
                  <p className="max-w-2xl text-sm text-white/75">
                    Pick the parent directory for new projects. You can start with a sample workspace, or create a named
                    project folder of your own inside the selected directory.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleStart}
                  disabled={loading || isStarting}
                  className="min-w-[140px] shrink-0 bg-[#48cfff] text-[#0c0f1a] hover:bg-[#38b3e0]"
                >
                  {isStarting ? "Preparing..." : "Start"}
                </Button>
              </div>

              <div className="rounded-2xl border border-[--panel-border] bg-white/5 p-5 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="default-project-directory" className="text-white">Default project directory</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="default-project-directory"
                      value={directory}
                      onChange={(event) => setDirectory(event.target.value)}
                      placeholder={loading ? "Loading..." : "Choose a folder"}
                      className="h-11 flex-1 border-[--panel-border] bg-black/20 text-white placeholder:text-white/35"
                      disabled={loading || isStarting}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      onClick={handleBrowseDirectory}
                      disabled={loading || isStarting}
                      className="h-11 border-[#48cfff] bg-transparent text-white hover:bg-[#48cfff]/10"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Browse
                    </Button>
                  </div>
                </div>

                {!useSampleProject && (
                  <div className="space-y-2">
                    <Label htmlFor="project-name" className="text-white">Project name (optional)</Label>
                    <Input
                      id="project-name"
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                      placeholder="my-project"
                      className="h-11 border-[--panel-border] bg-black/20 text-white placeholder:text-white/35"
                      disabled={isStarting}
                    />
                    <p className="text-xs text-white/55">
                      Voiden will create this folder inside the selected directory and open that new project, not the
                      parent directory itself. If left empty, Voiden will use <span className="text-white">my-project</span>.
                    </p>
                  </div>
                )}

                <label className="flex items-start gap-3 rounded-xl border border-[--panel-border] bg-black/20 p-4 cursor-pointer">
                  <Checkbox
                    checked={useSampleProject}
                    onCheckedChange={(checked) => setUseSampleProject(checked === true)}
                    disabled={isStarting}
                    className="mt-0.5 border-[#48cfff]/60 data-[state=checked]:bg-[#48cfff] data-[state=checked]:text-[#0c0f1a]"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium text-white">Populate with a sample project</span>
                    <span className="block text-xs text-white/65">
                      Voiden will create a sample workspace in the selected directory so you can explore requests, docs,
                      and tests immediately.
                    </span>
                  </span>
                </label>

                {error && (
                  <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center overflow-hidden h-full">
            <img
              src={steps[currentStep].img}
              alt={steps[currentStep].graphic}
              className={cn("w-[60%] h-fit max-h-[545px] scale-125", currentStep === 0 && "scale-100 h-[470px] object-cover object-left")}
            />
            <div className="pl-4 flex flex-col justify-center h-full relative bg-[#0c0f1a]">
              <div className="pt-4">
                <h2 className="text-[#48cfff] bg-gradient-to-r from-[#48cfff] to-[#b36dff] bg-clip-text text-transparent font-medium text-4xl mb-4">
                  {steps[currentStep].title}
                </h2>
                <p className="text-md text-white">{steps[currentStep].copy}</p>
              </div>

              <div className="flex justify-between mt-6 absolute bottom-0 right-0 w-full pl-4">
                {currentStep > 0 ? (
                  <Button
                    onClick={() => setCurrentStep(currentStep - 1)}
                    variant="outline"
                    size="sm"
                    className="w-[120px] text-white border-[#48cfff] hover:bg-[#0c0f1a]"
                  >
                    Back
                  </Button>
                ) : (
                  <div className="w-[120px]" />
                )}
                {currentStep < steps.length - 1 ? (
                  <Button
                    onClick={() => setCurrentStep(currentStep + 1)}
                    variant="outline"
                    size="sm"
                    className="w-[120px] text-white border-[#48cfff] bg-[#48cfff] hover:bg-[#38b3e0]"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    onClick={handleFinish}
                    variant="outline"
                    size="sm"
                    className="w-[120px] text-white border-[#48cfff] bg-[#48cfff] hover:bg-[#38b3e0]"
                  >
                    Finish
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
