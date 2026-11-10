import type { WorkspaceProfileDefinition } from "../definition";

export const HEALTH_PROFILE_DEFINITION: WorkspaceProfileDefinition = {
  id: "health",
  label: "Bazmed (Health)",
  description:
    "Усиленная сборка для чувствительных записей. Доступна только в build:health.",
  logoText: "H·WX",
  accent: "#ef4444",
  sections: [
    {
      id: "sensitive",
      title: "Чувствительные записи",
      schemaIds: ["sensitive-object"],
      emptyTitle: "Записей нет",
      emptyDescription:
        "Записи появятся после работы в сервисах домена или импорта пакета.",
    },
  ],
  unknownObjectsSection: {
    title: "Прочие объекты",
    description: "Объекты, не относящиеся к типам профиля Health.",
  },
};
