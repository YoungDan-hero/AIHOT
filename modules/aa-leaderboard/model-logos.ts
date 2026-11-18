// Keys are the stable model_creator.id values from Artificial Analysis.
// Brand assets match https://artificialanalysis.ai/models and are served locally.
const logos = new Map([
  ["d874d370-74d3-4fa0-ba00-5272f92f946b", "alibaba.svg"], // Alibaba
  ["f0aa413f-e8ae-4fcd-9c48-0e049f4f3128", "anthropic.svg"], // Anthropic
  ["904308e3-2682-4750-b66e-d440865eb05f", "apodex.svg"], // Apodex
  ["7e7b7290-eacc-420e-a35f-7c8eb4e5205d", "china-mobile.png"], // China Mobile
  ["671d3708-c407-4b8f-b350-f728e4689d26", "cohere.svg"], // Cohere
  ["58b835bf-4c87-4f87-a846-df4b692c6e7d", "deepseek.svg"], // DeepSeek
  ["faddc6d9-2c14-445f-9b28-56726f59c793", "google.svg"], // Google
  ["512ef1e4-e02e-4532-a5f2-d11a40962498", "ibm.svg"], // IBM
  ["4df238a9-d4fd-4cf2-ab1e-d12956c41f9b", "inclusionai.jpg"], // InclusionAI
  ["8b8b84fb-4b24-45be-b9e2-74ed50d00ff7", "ifm.svg"], // Institute of Foundation Models
  ["43c8d351-ffad-468c-83d2-26198bbf7c61", "joy-ai.svg"], // Joy Future Academy
  ["0a177021-87dd-4250-9a37-f01df196bfe0", "kimi.jpg"], // Kimi
  ["45157c16-fcbb-4110-b20f-7bca754b6554", "lg.png"], // LG AI Research
  ["5b1886c4-43ba-4007-b840-9d21a2b7d42c", "liquidai.svg"], // Liquid AI
  ["e1694725-0192-4e54-b1b8-c97e816c6cbe", "meta.svg"], // Meta
  ["a31a9071-6144-4dbb-92dc-2e02d653ecea", "minimax.svg"], // MiniMax
  ["b5c0639a-cc9c-443b-a07e-bae6b7088933", "mistral.svg"], // Mistral
  ["c1c9377c-4745-4762-94b7-88c045ccda28", "nanbeige.png"], // Nanbeige
  ["0c303112-430d-4367-a484-51defaa2e166", "nvidia.svg"], // NVIDIA
  ["e67e56e3-15cd-43db-b679-da4660a69f41", "openai.svg"], // OpenAI
  ["90bf1f7e-b589-4f69-8efc-bd04bbd0b494", "reflection.svg"], // Reflection
  ["5db3af1a-e372-4c62-98bd-f6027eeaf990", "sapiens.svg"], // Sapiens AI
  ["b943b29d-0549-4b21-aa0f-3dd955ee12e2", "sktelecom.svg"], // SK Telecom
  ["a1e3ddcf-d3e4-44a5-9e8f-029a69850875", "spacexai.svg"], // SpaceXAI
  ["ce2e2e8b-7a22-4020-98ec-8ef71000dd42", "stepfun.svg"], // StepFun
  ["a4e5bd55-a6cd-4dcf-8d4a-1d9643cd3826", "tencent-hy.svg"], // Tencent
  ["8f3f9fdd-e42f-4814-a35e-5da1925b539b", "thinking-machines.svg"], // Thinking Machines
  ["64ff7f06-c6fb-42ea-ba24-9cd103ab2d61", "upstage.svg"], // Upstage
  ["5147c8b4-61d5-4070-9324-8adf8aa144c2", "xiaomi.svg"], // Xiaomi
  ["67437eb6-7dc1-4e93-befd-22c8b8ec2065", "zai.svg"], // Z AI
]);

export function modelLogo(creatorId: string | undefined): string | null {
  const file = creatorId && logos.get(creatorId);
  return file ? `/model-logos/${file}` : null;
}
