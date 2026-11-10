import type { WorkspaceProfileDefinition } from "../definition";

export const ORGANIZATION_PROFILE_DEFINITION: WorkspaceProfileDefinition = {
  id: "organization",
  label: "Организация",
  description:
    "Диагностика, аналитика, выводы, риски, действия, процессы и маршруты.",
  logoText: "O·WX",
  accent: "#f59e0b",
  sections: [
    {
      id: "cases",
      title: "Диагностические кейсы",
      schemaIds: ["diagnostic-case"],
      emptyTitle: "Кейсов нет",
      emptyDescription:
        "Кейсы появятся после диагностики в сервисах домена или импорта пакета.",
    },
    {
      id: "results",
      title: "Аналитические результаты",
      schemaIds: ["analytical-result"],
      emptyTitle: "Аналитических результатов нет",
      emptyDescription:
        "Результаты появятся после аналитической работы в сервисах домена.",
    },
    {
      id: "findings",
      title: "Выводы",
      schemaIds: ["finding"],
      emptyTitle: "Выводов нет",
      emptyDescription:
        "Выводы появятся после анализа в сервисах домена.",
    },
    {
      id: "risks",
      title: "Риски",
      schemaIds: ["risk"],
      emptyTitle: "Рисков нет",
      emptyDescription:
        "Риски появятся после оценки в сервисах домена.",
    },
    {
      id: "actions",
      title: "Действия",
      schemaIds: ["action"],
      emptyTitle: "Действий нет",
      emptyDescription:
        "Действия появятся после планирования в сервисах домена.",
    },
    {
      id: "processes",
      title: "Процессы",
      schemaIds: ["process"],
      emptyTitle: "Процессов нет",
      emptyDescription:
        "Процессы появятся после описания в сервисах домена.",
    },
    {
      id: "routes",
      title: "Маршруты",
      schemaIds: ["route"],
      emptyTitle: "Маршрутов нет",
      emptyDescription:
        "Маршруты появятся после планирования в сервисах домена.",
    },
  ],
  unknownObjectsSection: {
    title: "Прочие объекты",
    description: "Объекты, не относящиеся к типам профиля Organization.",
  },
};
