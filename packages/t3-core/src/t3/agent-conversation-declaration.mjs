// Agent-owned conversation history in the original T2/T3 Workspace.
// No Store, inference runtime, Task/Result authority, or exchange format.
export const AGENT_CONVERSATION_SCHEMA="iwxa.agent.conversation.history";
export const AGENT_CONVERSATION_DECLARATION=Object.freeze({
  schema_version:"1.0.0",preserve_unknown:false,
  json_schema:{
    type:"object",additionalProperties:false,
    required:["conversation_id","source_revision","first_turn","total_turns","turns","source"],
    properties:{
      conversation_id:{type:"string",pattern:"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$"},
      source_revision:{type:"integer",minimum:1,maximum:9007199254740991},
      first_turn:{type:"integer",minimum:1,maximum:9007199254740991},
      total_turns:{type:"integer",minimum:1,maximum:9007199254740991},
      turns:{type:"array",minItems:1,maxItems:100,items:{
        type:"object",additionalProperties:false,required:["prompt","answer","runtime"],
        properties:{
          prompt:{type:"string",minLength:1,maxLength:12000},
          answer:{type:"string",minLength:1,maxLength:200000},
          runtime:{type:"object",additionalProperties:false,required:["kind","model"],
            properties:{kind:{enum:["local","cloud"]},model:{type:"string",minLength:1,maxLength:300},
              provider:{type:"string",pattern:"^[a-z0-9-]{1,80}$"}},
            oneOf:[{properties:{kind:{const:"local"}},not:{required:["provider"]}},
              {properties:{kind:{const:"cloud"}},required:["provider"]}]},
        },
      }},
      source:{const:"USER_EXPLICIT_SAVE"},
    },
  },
  embedded:{},
});
