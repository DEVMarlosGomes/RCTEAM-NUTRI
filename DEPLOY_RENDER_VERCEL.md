# Deploy do RC Team Nutri — Render + Vercel

Arquitetura recomendada:

- Backend FastAPI no Render.
- Frontend React no Vercel.
- MongoDB em um cluster MongoDB Atlas já existente ou novo.
- IA pela API oficial da Anthropic; Gemini é opcional.

## 1. Preparação do repositório

1. Confirme que o projeto está em um repositório GitHub.
2. Nunca envie os arquivos `backend/.env` ou `frontend/.env` ao Git. O `.gitignore` já os protege.
3. Use [backend/.env.example](backend/.env.example) e [frontend/.env.example](frontend/.env.example) somente como referência.
4. Envie as alterações:

```bash
git add .
git commit -m "Configura deploy Render e Vercel"
git push origin main
```

## 2. Preparar MongoDB Atlas

1. Acesse o MongoDB Atlas e crie um cluster, se ainda não houver um.
2. Em **Database Access**, crie um usuário exclusivo para a aplicação.
3. Em **Network Access**, permita conexões do Render. Para começar, pode ser necessário usar `0.0.0.0/0`; use senha forte e restrinja a rede quando sua infraestrutura permitir.
4. Em **Connect > Drivers**, copie a URI `mongodb+srv://...`.
5. Substitua usuário, senha e nome do banco na URI. Caracteres especiais da senha precisam estar codificados para URL.

## 3. Publicar o backend no Render

O arquivo [render.yaml](render.yaml) já define o serviço, comando correto, diretório `backend` e health check.

1. Acesse o Dashboard do Render.
2. Clique em **New > Blueprint**.
3. Conecte sua conta GitHub e selecione este repositório.
4. Confirme o Blueprint encontrado em `render.yaml`.
5. Preencha as variáveis solicitadas:

| Variável | Valor |
|---|---|
| `MONGO_URL` | URI completa do MongoDB Atlas |
| `ANTHROPIC_API_KEY` | Chave criada na Anthropic Console |
| `ADMIN_EMAIL` | E-mail inicial do administrador |
| `ADMIN_PASSWORD` | Senha forte do administrador |
| `FRONTEND_URLS` | Inicialmente `http://localhost:3000`; será atualizada após criar o Vercel |

O Render gera `JWT_SECRET` automaticamente. `DB_NAME`, `ADMIN_NAME` e a versão do Python já estão definidos.

6. Clique em **Apply** e acompanhe os logs.
7. Quando concluir, copie a URL, por exemplo:

```text
https://rcteam-nutri-api.onrender.com
```

8. Valide:

```text
https://rcteam-nutri-api.onrender.com/health
https://rcteam-nutri-api.onrender.com/docs
```

O primeiro endereço deve retornar `{"status":"ok"}`.

### Gemini opcional

Se quiser usar Gemini como provedor prioritário, adicione manualmente `GEMINI_KEY` em **Render > Service > Environment**. Sem essa variável, o sistema usa Anthropic diretamente.

## 4. Publicar o frontend no Vercel

O arquivo [frontend/vercel.json](frontend/vercel.json) define o build CRA, a pasta `build` e o fallback das rotas React.

1. Acesse o Dashboard do Vercel.
2. Clique em **Add New > Project**.
3. Importe o mesmo repositório GitHub.
4. Em **Root Directory**, clique em **Edit** e selecione `frontend`.
5. Confirme:

| Configuração | Valor |
|---|---|
| Framework Preset | Create React App |
| Install Command | `yarn install --frozen-lockfile` |
| Build Command | `yarn build` |
| Output Directory | `build` |

6. Em **Environment Variables**, adicione para Production, Preview e Development:

```text
REACT_APP_BACKEND_URL=https://rcteam-nutri-api.onrender.com
```

Não coloque `/api` nem barra final no valor.

7. Clique em **Deploy**.
8. Copie a URL final, por exemplo:

```text
https://rcteam-nutri.vercel.app
```

## 5. Liberar o domínio do Vercel no Render

1. Volte para **Render > rcteam-nutri-api > Environment**.
2. Atualize `FRONTEND_URLS`:

```text
https://rcteam-nutri.vercel.app,http://localhost:3000
```

3. Salve. O Render reiniciará o backend.
4. Se usar mais de um domínio de produção, separe-os por vírgula.
5. Previews `*.vercel.app` já são aceitos pelo CORS, mas não devem substituir o domínio de produção em `FRONTEND_URLS`.

## 6. Fazer um novo deploy do Vercel

Depois de confirmar a URL do Render e atualizar a variável:

1. Abra **Vercel > Deployments**.
2. No último deploy, use **Redeploy**.
3. Não reutilize um build antigo se tiver alterado `REACT_APP_BACKEND_URL`, porque variáveis `REACT_APP_*` são incorporadas durante o build.

## 7. Checklist pós-deploy

Teste em janela anônima:

1. Abrir a landing page.
2. Acessar `/login` e entrar como administrador.
3. Criar, editar e excluir um paciente de teste.
4. Abrir diretamente `/pacientes/ID_DO_PACIENTE` e atualizar a página; não deve retornar 404.
5. Criar uma consulta na agenda.
6. Testar uma função de IA.
7. Confirmar no DevTools que chamadas vão para `https://...onrender.com/api`.
8. Confirmar que não há erro de CORS nem bloqueio de cookie.

## 8. Domínio próprio

1. No Vercel, adicione o domínio do site em **Settings > Domains**.
2. No Render, adicione o domínio da API, como `api.seudominio.com`, em **Settings > Custom Domains**.
3. Troque `REACT_APP_BACKEND_URL` no Vercel para `https://api.seudominio.com` e faça novo deploy.
4. Troque `FRONTEND_URLS` no Render para o domínio definitivo do frontend.

## 9. Atualizações futuras

- Pushes na branch conectada acionam deploy automático no Render e no Vercel.
- Alterações apenas no backend não exigem rebuild manual do frontend, exceto quando a URL pública da API mudar.
- Segredos devem ser alterados somente nos dashboards das plataformas, nunca nos arquivos versionados.

Documentação oficial:

- [Render Blueprints](https://render.com/docs/blueprint-spec)
- [Variáveis de ambiente no Render](https://render.com/docs/configure-environment-variables)
- [Create React App no Vercel](https://vercel.com/docs/frameworks/frontend/create-react-app)
- [Monorepos no Vercel](https://vercel.com/docs/monorepos)
- [Configuração `vercel.json`](https://vercel.com/docs/project-configuration/vercel-json)
