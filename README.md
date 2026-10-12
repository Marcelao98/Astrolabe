# Astrolabe ✦

Veja o seu armazenamento como uma **galáxia**: cada pasta é um sol, cada arquivo um planeta, e o tamanho vira raio. Ache o gargalo em um olhar, pinte o mapa por tipo, idade, tamanho ou duplicados, e peça para a **Astra** (a robô-assistente) explicar, limpar e organizar — sempre com plano → aprovação → execução → desfazer.

Funciona com: **dados de exemplo** (já na tela), **disco local / HD externo** (via agente local) e **Google Drive**.

## Rodar

```bash
pnpm install
pnpm dev          # interface em http://localhost:5173 (já abre com dados de exemplo)
pnpm dev:api      # opcional: API da Astra. Com ANTHROPIC_API_KEY usa o Claude; sem ela, modo simples
```

Sem a API, a Astra responde no próprio navegador (regras em português). Com `ANTHROPIC_API_KEY=... pnpm dev:api`, ela passa a usar o Claude (modelo em `ASTRA_MODEL`, padrão `claude-sonnet-5-5`) com ferramentas validadas. Ela só enxerga **metadados** (nome, caminho, tipo, tamanho, datas).

### Ver o seu disco de verdade

No Windows (ou qualquer sistema), numa janela de terminal:

```bash
pnpm dev:agent D:\            # libera só esta pasta/disco; pode listar várias
```

O agente mostra um **token**. Na interface: **Conectar PC** → cole o token → escolha a pasta → *Escanear*. Ele escuta apenas em `127.0.0.1`, exige o token e só mexe nas pastas liberadas ao iniciar.

### Google Drive

1. No Google Cloud Console crie um *OAuth Client ID* do tipo **Aplicativo da Web**, com origem `http://localhost:5173`, e ative a **Google Drive API**.
2. Crie `apps/web/.env.local` com `VITE_GOOGLE_CLIENT_ID=seu-id.apps.googleusercontent.com`.
3. **Conectar PC → Google Drive**. Por padrão o acesso é só leitura de metadados; marque *Permitir mudanças* para a Astra poder mover/enviar à lixeira do Drive.

## Segurança (resumo)

- A IA **só propõe**. Não existe ferramenta para executar nem aprovar: a aprovação nasce de um clique seu, para aquele plano específico (e pode ser parcial).
- Nada é apagado de vez: **quarentena** (pasta `.astrolabe-quarantine`, reversível) ou **lixeira do sistema / do Drive**.
- Pastas do sistema (Windows, Program Files, `.git`, `.ssh`…) são intocáveis; caminhos são normalizados, links simbólicos não saem das pastas liberadas, e cada ação é validada antes de qualquer mudança.
- Nomes de arquivos são tratados como **dados não confiáveis** (defesa contra prompt injection); entradas do modelo são validadas com zod.
- Agente local: token, CORS só para `localhost`, escopo de pastas fixado na inicialização.
- Log de execução e botão **Desfazer**.

## Estrutura

| Pasta | O que é |
|---|---|
| `packages/core` | modelo de dados, agregação, escalas, lentes, layout orbital, duplicados, amostra |
| `packages/render` | renderizador Canvas 2D da galáxia (câmera, sprites, rótulos, seleção) |
| `packages/actions` | planos, estratégias, executor, quarentena, desfazer, regras de segurança |
| `packages/agents` | Astra: ferramentas, classificador, provedor simples e provedor LLM |
| `packages/drive` | conector do Google Drive (scan, driver do executor) |
| `apps/web` | interface (React + Vite) |
| `apps/api` | API da Astra (Fastify, SSE, adaptador Anthropic) |
| `apps/local-agent` | agente local para disco/HD externo |

`pnpm test` · `pnpm typecheck` · `pnpm build`. Detalhes de arquitetura em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

> A arte da Astra é um SVG provisório (original); dá para trocar por uma ilustração melhor depois.
