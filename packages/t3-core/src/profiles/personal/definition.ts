import type { WorkspaceProfileDefinition } from "../definition";

export const PERSONAL_PROFILE_DEFINITION: WorkspaceProfileDefinition = {
  id: "personal",
  label: "Личный",
  description: "Роли, цели, проекты, доказательства и события деятельности.",
  logoText: "P·WX",
  accent: "#10b981",
  sections: [
    {
      id: "roles",
      title: "Роли",
      schemaIds: ["role"],
      emptyTitle: "Ролей нет",
      emptyDescription:
        "Роли появятся после работы в сервисах домена или импорта пакета.",
    },
    {
      id: "goals",
      title: "Цели",
      schemaIds: ["goal"],
      emptyTitle: "Целей нет",
      emptyDescription:
        "Цели появятся после работы в сервисах домена или импорта пакета.",
    },
    {
      id: "projects",
      title: "Проекты",
      schemaIds: ["project"],
      emptyTitle: "Проектов нет",
      emptyDescription:
        "Проекты появятся после работы в сервисах домена или импорта пакета.",
    },
    {
      id: "evidence",
      title: "Доказательства",
      schemaIds: ["evidence"],
      emptyTitle: "Доказательств нет",
      emptyDescription:
        "Доказательства появятся после работы в сервисах домена.",
    },
    {
      id: "activity",
      title: "Активность",
      schemaIds: ["activity-event"],
      emptyTitle: "Событий активности нет",
      emptyDescription:
        "События активности появятся после работы в сервисах домена.",
    },
  ],
  unknownObjectsSection: {
    title: "Прочие объекты",
    description: "Объекты, не относящиеся к типам профиля Personal.",
  },
};
