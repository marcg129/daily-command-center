import {
  INDELITECH_WORKSPACE_ID,
  PERSONAL_WORKSPACE_ID,
  isProductWorkspaceId,
  type ProductWorkspaceId,
} from "./runtime/context";

export const WORKSPACE_SELECTION_STORAGE_KEY = "daily-command-center-workspace";
export const DEFAULT_WORKSPACE_ID = PERSONAL_WORKSPACE_ID;

export type WorkspacePageId =
  | "today"
  | "tasks"
  | "calendar"
  | "news"
  | "industry"
  | "mentions"
  | "settings";

export type WorkspaceNavigationItem = Readonly<{
  id: WorkspacePageId;
  label: string;
  icon: "today" | "tasks" | "calendar" | "news" | "intel" | "mentions" | "settings";
}>;

export type WorkspacePresentation = Readonly<{
  id: ProductWorkspaceId;
  displayName: string;
  workspaceType: "PERSONAL" | "BUSINESS";
  themeKey: "personal-tech-blue" | "indelitech-business";
  descriptor: string;
  navigation: readonly WorkspaceNavigationItem[];
}>;

export const WORKSPACES: Readonly<Record<ProductWorkspaceId, WorkspacePresentation>> = {
  personal: {
    id: PERSONAL_WORKSPACE_ID,
    displayName: "Personal",
    workspaceType: "PERSONAL",
    themeKey: "personal-tech-blue",
    descriptor: "Personal focus",
    navigation: [
      { id: "today", label: "Today", icon: "today" },
      { id: "tasks", label: "Tasks", icon: "tasks" },
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "news", label: "News", icon: "news" },
      { id: "settings", label: "Settings", icon: "settings" },
    ],
  },
  indelitech: {
    id: INDELITECH_WORKSPACE_ID,
    displayName: "Indelitech",
    workspaceType: "BUSINESS",
    themeKey: "indelitech-business",
    descriptor: "Business operations",
    navigation: [
      { id: "today", label: "Today", icon: "today" },
      { id: "tasks", label: "Tasks", icon: "tasks" },
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "industry", label: "Intel", icon: "intel" },
      { id: "mentions", label: "Mentions", icon: "mentions" },
      { id: "settings", label: "Settings", icon: "settings" },
    ],
  },
};

export const WORKSPACE_OPTIONS = [WORKSPACES.personal, WORKSPACES.indelitech] as const;

export function parseWorkspaceId(value: unknown): ProductWorkspaceId {
  return isProductWorkspaceId(value) ? value : DEFAULT_WORKSPACE_ID;
}

export function isWorkspacePageAvailable(workspaceId: ProductWorkspaceId, pageId: WorkspacePageId) {
  return WORKSPACES[workspaceId].navigation.some((item) => item.id === pageId);
}
