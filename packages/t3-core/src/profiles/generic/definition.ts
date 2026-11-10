import type { WorkspaceProfileDefinition } from "../definition";

/**
 * Generic profile — universal fallback shown when the domain does not
 * pin a profile or when the requested profile is unknown.
 *
 * Empty-state copy intentionally does not promise object creation inside
 * Workspace: T2 is read-only for user content and object creation happens
 * in connected services or through an imported .iwxa package.
 */
export const GENERIC_PROFILE_DEFINITION: WorkspaceProfileDefinition = {
  id: "generic",
  label: "Универсальный",
  description:
    "Универсальная оболочка IWXA. Отображает рабочие области любого домена без предварительной настройки.",
  logoText: "IWXA",
  accent: "#64748b",
  sections: [
    {
      id: "all",
      title: "Все объекты",
      description: "Все объекты, доступные ядру в этой рабочей области.",
      schemaIds: [],
      emptyTitle: "Пока нет объектов",
      emptyDescription:
        "Объекты появятся после работы в подключённых сервисах домена или после импорта пакета .iwxa.",
    },
    {
      id: "documents",
      title: "Документы",
      description: "Заметки, документы и колоды карточек.",
      schemaIds: ["note", "document", "deck"],
      emptyTitle: "Документов нет",
      emptyDescription:
        "Заметки и документы появятся после работы в подключённых сервисах домена.",
    },
    {
      id: "projects",
      title: "Проекты и задачи",
      description: "Проекты и связанные с ними задачи.",
      schemaIds: ["project", "task"],
      emptyTitle: "Проектов и задач нет",
      emptyDescription:
        "Проекты и задачи появятся после работы в подключённых сервисах домена.",
    },
  ],
  unknownObjectsSection: {
    title: "Прочие объекты",
    description:
      "Объекты неизвестного типа отображаются здесь без специализированного рендера.",
  },
};
