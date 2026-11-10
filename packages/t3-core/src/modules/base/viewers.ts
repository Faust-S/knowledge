/** Built-in profile viewers registered in the one Host ViewerRegistry. */
import type { ViewerContribution, ViewerProps } from "@/workspace-contract";
import { PreviewCard } from "@/renderers/PreviewCard";
import { truncatePreviewText } from "@/renderers/preview";
import type { ComponentType } from "react";
import { createElement } from "react";
const owners = {
 generic: [
  ["note","Заметка",()=>import("@/renderers/NoteRenderer").then(m=>m.NoteRenderer)],
  ["deck","Колода",()=>import("@/renderers/DeckRenderer").then(m=>m.DeckRenderer)],
  ["project","Проект",()=>import("@/renderers/ProjectRenderer").then(m=>m.ProjectRenderer)],
 ],
 personal: [
  ["role","Роль",()=>import("@/profiles/personal/renderers").then(m=>m.RoleRenderer)],
  ["goal","Цель",()=>import("@/profiles/personal/renderers").then(m=>m.GoalRenderer)],
  ["project","Проект",()=>import("@/profiles/personal/renderers").then(m=>m.ProjectRenderer)],
  ["evidence","Доказательство",()=>import("@/profiles/personal/renderers").then(m=>m.EvidenceRenderer)],
  ["activity-event","Событие",()=>import("@/profiles/personal/renderers").then(m=>m.ActivityEventRenderer)],
 ],
 learning: [
  ["learning-goal","Цель обучения",()=>import("@/profiles/learning/renderers").then(m=>m.LearningGoalRenderer)],
  ["competency","Компетенция",()=>import("@/profiles/learning/renderers").then(m=>m.CompetencyRenderer)],
  ["competency-gap","Пробел",()=>import("@/profiles/learning/renderers").then(m=>m.CompetencyGapRenderer)],
  ["career-route","Карьерный маршрут",()=>import("@/profiles/learning/renderers").then(m=>m.CareerRouteRenderer)],
  ["learning-route","Маршрут обучения",()=>import("@/profiles/learning/renderers").then(m=>m.LearningRouteRenderer)],
  ["task","Задача",()=>import("@/profiles/learning/renderers").then(m=>m.TaskRenderer)],
  ["practice-result","Практика",()=>import("@/profiles/learning/renderers").then(m=>m.PracticeResultRenderer)],
  ["reflection","Рефлексия",()=>import("@/profiles/learning/renderers").then(m=>m.ReflectionRenderer)],
 ],
 organization: [
  ["diagnostic-case","Диагностика",()=>import("@/profiles/organization/renderers").then(m=>m.DiagnosticCaseRenderer)],
  ["analytical-result","Аналитика",()=>import("@/profiles/organization/renderers").then(m=>m.AnalyticalResultRenderer)],
  ["finding","Вывод",()=>import("@/profiles/organization/renderers").then(m=>m.FindingRenderer)],
  ["risk","Риск",()=>import("@/profiles/organization/renderers").then(m=>m.RiskRenderer)],
  ["action","Действие",()=>import("@/profiles/organization/renderers").then(m=>m.ActionRenderer)],
  ["process","Процесс",()=>import("@/profiles/organization/renderers").then(m=>m.ProcessRenderer)],
  ["route","Маршрут",()=>import("@/profiles/organization/renderers").then(m=>m.RouteRenderer)],
 ],
 health: [
  ["sensitive-object","Запись",()=>import("@/profiles/health/renderers").then(m=>m.SensitiveObjectRenderer)],
 ],
} satisfies Record<string, Array<[string,string,()=>Promise<ComponentType<ViewerProps>>]>>;
export function buildBaseViewerContributions(): ViewerContribution[] {
 const results: ViewerContribution[]=[];
 for(const [profileId, entries] of Object.entries(owners)){
  for(const [schemaId,label,getComponent] of entries){
   for(const surface of ["preview","detail"] as const){
    results.push({
     kind:"viewer",id:`builtin.${profileId}.${schemaId}.${surface}`,
     moduleId:"iwxa.workspace.base",requiredOperations:[],
     profileId,schemaId,schemaVersionRange:"*",surface,label,
     loader:async()=>{
      const Component=await getComponent();
      if(surface==="detail")return {default:Component};
      const Preview:ComponentType<ViewerProps>=({data})=>{
       const d=(data??{}) as Record<string,unknown>;
       const title=typeof d.title==="string"?d.title:null;
       const summary=truncatePreviewText(d.summary??d.body??d.description??d.notes??null);
       return createElement(PreviewCard,{rendererType:schemaId,title,summary,
        chips:createElement("span",null,label)});
      };
      return {default:Preview};
     },
    });
   }
  }
 }
 return results;
}
