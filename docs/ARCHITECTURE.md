# Astrolabe — Arquitetura

> Um mapa em forma de galáxia para qualquer armazenamento (HD local, HD externo, Google Drive), com uma agente de IA que entende o que você seleciona e age sobre isso — sempre com plano, aprovação e desfazer.

Status: rascunho v0.1 (decisões em aberto marcadas com **[DECIDIR]**).

---

## 1. Princípios

1. **Poucos agentes de IA, muito código determinístico.** Scanner, hash e execução de ações são código previsível. A IA entra só onde há julgamento.
2. **A IA nunca executa.** Ela propõe um plano; o motor de ações executa depois da aprovação do usuário.
3. **Nada é apagado de verdade por padrão.** Tudo vai para a quarentena / lixeira, com log e desfazer.
4. **Privacidade por padrão.** A IA recebe só metadados (nome, caminho, tipo, tamanho, datas). Ler conteúdo é opt-in e avisa o que será enviado.
5. **Um modelo de dados único** para todas as fontes. Adicionar OneDrive/Dropbox deve ser só escrever um conector.
6. **A visualização é o produto.** Performance (Canvas/WebGL) e beleza vêm antes de funcionalidades extras.

## 2. Camadas

```
Frontend (galáxia + painéis + chat da Astra)
        │
API / orquestração
        │
┌───────┼──────────────┬───────────────┐
Agentes de IA    Serviços de análise   Motor de ações
(julgamento)     (código puro)         (plano → aprova → executa → desfaz)
        │
Índice central (SQLite): nós, hashes, categorias, snapshots
        │
Conectores de fonte: Local (Windows / HD externo) · Google Drive · (futuro)
```

## 3. Agentes de IA (3)

São **ferramentas que a Astra chama**, não bots conversando entre si.

| Agente | Função | Quando roda |
|---|---|---|
| **Astra (orquestradora)** | Conversa, entende o pedido, escolhe ferramentas, cria lentes e dashboards na hora | Sempre que o usuário fala |
| **Classificador** | Aplica um critério em linguagem natural a um conjunto de nós ("o que parece contrato?") e devolve categoria + confiança | Em lote, sob demanda |
| **Planejador** | Transforma uma intenção ("organiza meus downloads") em um plano de ações revisável | Quando o usuário pede para organizar |

## 4. Serviços determinísticos (sem IA)

- **Scanner** — percorre a fonte e grava metadados no índice.
- **Hasher** — hash em etapas (tamanho → hash parcial → hash completo) para ler só o necessário. No Drive usa o MD5 entregue pela API.
- **Agregador** — soma tamanhos de pastas, conta itens, calcula idade e percentuais.
- **Detector de duplicados** — agrupa por hash e gera arestas entre nós.
- **Executor de ações** — move, renomeia, envia para quarentena/lixeira e desfaz. Nunca decide nada sozinho.

## 5. Modelo de dados

Todo item, de qualquer fonte, vira um `Nó`:

```
id, source_id, path, name,
kind (folder | file),
size_bytes, size_aggregated (pastas),
created_at, modified_at, accessed_at,
parent_ids[]   // lista: no Drive um arquivo pode ter vários pais → é um grafo
hash, mime, category, category_confidence
```

Entidades auxiliares: `Source`, `Snapshot` (scan offline de HD externo), `Lens` (critério salvo + paleta), `Plan` / `Action` / `ActionLog` (com dados para desfazer), `QuarantineItem`.

## 6. Visualização (resumo — detalhes em `docs/VISUAL.md`)

- Renderização em **Canvas 2D** inicialmente (WebGL como evolução); SVG não escala (limite prático ~2.500 nós).
- **Pasta** = "sol": círculo grande com anel e halo, rótulo sempre visível, tamanho = soma do conteúdo.
- **Arquivo** = "planeta/estrela": ponto sólido pequeno, rótulo só no zoom/hover.
- **Escala do raio**: logarítmica por padrão nas pastas, raiz quadrada para arquivos dentro da pasta aberta, com alternador (log / raiz / linear) e legenda de círculos de referência (1 MB, 100 MB, 10 GB).
- **Lentes** (mesmo grafo, outra cor/filtro): tipo, idade, tamanho, duplicados, e lentes criadas em linguagem natural.
- **Colapso/expansão** de pastas para manter o grafo legível em discos grandes.

## 7. Ações e segurança

1. Usuário seleciona nós (ou pede em linguagem natural).
2. Planejador gera um **plano** (lista de ações com origem, destino, motivo, espaço liberado).
3. **Dry-run** mostra o efeito no grafo antes de qualquer coisa.
4. Usuário **aprova** (por ação ou em lote).
5. Executor aplica, grava **log reversível**.
6. Itens removidos vão para **quarentena/lixeira** com retenção configurável; exclusão definitiva é sempre uma etapa separada e explícita.

### Fonte local x nuvem

Um navegador ou servidor na nuvem **não enxerga o disco do usuário**. Para operar no PC, é necessário um **agente local** pequeno (app Tauri/Electron ou serviço em `localhost`) que:

- escaneia e executa ações no disco;
- só aceita comandos assinados pela sessão do usuário;
- por padrão envia para a **Lixeira do sistema** em vez de apagar.

Esse componente só roda no PC do usuário quando ele decidir instalá-lo. Até lá, o projeto funciona com dados de exemplo e com o Google Drive (100% web).

## 8. Fases

| Fase | Entrega |
|---|---|
| **0 — Protótipo** | Galáxia em Canvas com dados de exemplo; pasta ≠ arquivo; escala log/raiz/linear; lentes (tipo, idade, tamanho, duplicados); painel de totais e top 10; chat da Astra simulado |
| **1 — Agente** | Astra real; lentes em linguagem natural salvas; dashboards gerados na hora; relatórios exportáveis |
| **2 — Ações** | Seleção de nós; plano com dry-run; aprovação; quarentena; log; desfazer |
| **3 — Fontes reais** | Conector Google Drive (OAuth, escopo mínimo); agente local para Windows/HD externo |

## 9. Estrutura do repositório

```
astrolabe/
  apps/web/         # frontend (Canvas + painéis + chat)
  apps/api/         # API e orquestração
  packages/core/    # modelo de dados, índice, agregações
  packages/sources/ # conectores (local, drive)
  packages/agents/  # Astra, Classificador, Planejador
  packages/actions/ # plano, executor, quarentena, undo
  data/sample/      # gerador de dados de exemplo
  docs/             # arquitetura e decisões
```

## 10. Decisões em aberto

- **[DECIDIR] Stack:** TypeScript em tudo (recomendado: a Astra conversa direto com o grafo na tela) vs. backend em Python (mais natural para scanner/hash).
- **[DECIDIR] Reação ao vivo:** Astra responde em streaming e o grafo repinta ao vivo quando a lente muda.
- **[DECIDIR] Uso:** pessoal vs. multiusuário (muda como guardar tokens do Drive).
- **[DECIDIR] Agente local:** Tauri vs. Electron vs. serviço em localhost.
- **[DECIDIR] Personagem da Astra:** design original (sem inspiração direta em personagens existentes).

## 11. Projetos relacionados (pesquisa)

Analisadores de disco (WinDirStat, WizTree, DaisyDisk, MacDirStat, Diskmap), organizadores com IA em CLI (filemaid, Deep Organizer, LLM File Organizer), Filerev para Google Drive, grafos de arquivos para código (Codeflower, CodeGraphy) e indexadores (Diskover). Nenhum combina galáxia + múltiplas fontes + agente dentro do visual + lentes em linguagem natural — esse é o espaço do Astrolabe.


## Atualização (implementação)

- O renderizador é **Canvas 2D** (não PixiJS): testável em Node com Skia, sem WebGL, e rápido o bastante para ~40 mil nós com recorte, sprites em cache e splat de pixels.
- O gerador de amostra mora em `packages/core`.
- Fluxo de ações: `Astra (ferramenta propose_plan)` → `Plan` → cartão de aprovação (UI) → `Executor` (preflight + quarentena/lixeira + log) → `undo`.
- Fontes: `sample` (memória), `local` (`apps/local-agent`, HTTP + token em 127.0.0.1), `drive` (`packages/drive`, API v3 direto do navegador, token só em memória).
- A API da Astra recebe o mapa ativo por `PUT /api/tree` (somente metadados) para a IA ver o mesmo que o usuário.
