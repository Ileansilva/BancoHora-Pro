# BancoHora Pro 2.0

## Status desta cópia

Esta cópia já está conectada ao projeto Supabase **BancoHora Pro** (`jxifpqsuivryjudzbrxy`) na região `sa-east-1`.

Já configurado no projeto remoto:
- tabelas multiempresa
- RLS em todas as tabelas públicas do aplicativo
- grants somente para usuários autenticados
- bucket `company-logos`
- auditoria de funcionários e lançamentos
- índices de chaves estrangeiras
- Edge Function `invite-company-user` com JWT obrigatório

O arquivo `js/config.js` já contém a URL e a Publishable Key deste projeto. A Publishable Key pode ficar no frontend; nenhuma chave secreta foi incluída no pacote.

Antes de publicar em domínio definitivo, configure no Supabase **Authentication > URL Configuration** a URL pública do site e os Redirect URLs usados em confirmação de e-mail e recuperação de senha.


Versão profissional multiempresa com Supabase Auth, PostgreSQL, RLS, Storage e Edge Function para convites. O frontend fixa `@supabase/supabase-js` em `2.111.0` e a função fixa `@supabase/server` em `1.4.1`.

## O que já está pronto

- Login real por e-mail e senha
- Cadastro de conta e confirmação de e-mail
- Recuperação de senha
- Cadastro da empresa no primeiro acesso
- Multiempresa com isolamento por RLS
- Perfis: Proprietário, Administrador e Responsável
- Cadastro, edição, inativação e reativação de funcionários
- Banco de horas positivo/negativo
- Lançamentos auditáveis com data, motivo e observação
- Histórico por funcionário
- WhatsApp individual e resumo geral
- Relatório por período, setor e situação
- Impressão / salvar como PDF
- Upload da logo no Supabase Storage
- Convite de usuários via Edge Function
- Layout responsivo e empresarial

## 1. Crie um projeto Supabase exclusivo

É recomendado criar um projeto separado para o BancoHora Pro, para não misturar tabelas e políticas com outros sistemas.

## 2. Execute o banco

No Supabase Dashboard, abra **SQL Editor** e execute o conteúdo de:

`supabase/schema.sql`

O script cria as tabelas, índices, RLS, políticas, triggers de auditoria e o bucket de logos.

## 3. Configure o site

Copie:

`js/config.example.js`

para:

`js/config.js`

Depois preencha:

```js
export const CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_...",
  APP_NAME: "BancoHora Pro 2.0"
};
```

Use somente a **Publishable Key** no navegador. Nunca coloque Secret Key/service_role no frontend.

## 4. Auth / URLs

No Supabase, em Authentication > URL Configuration:

- Site URL: a URL onde o site será publicado
- Redirect URLs: inclua a URL do site e a URL local de desenvolvimento

E-mail/senha normalmente vem habilitado. Em projetos hospedados, confirmação de e-mail pode estar habilitada por padrão.

## 5. Edge Function de convite

A função está em:

`supabase/functions/invite-company-user/index.ts`

Faça o deploy com JWT obrigatório. Ela usa o ambiente seguro do Supabase para chamar a API administrativa de Auth; a chave secreta nunca vai para o navegador.

Configure também o secret/variável:

`APP_URL=https://seu-dominio.com`

A função só permite convite quando o usuário autenticado é o proprietário da empresa.

## 6. Rodar localmente

Por usar módulos ES, abra por servidor HTTP. Exemplos:

- VS Code + Live Server
- `python -m http.server 5500`

Depois acesse `http://localhost:5500`.

## 7. Fluxo de teste

1. Criar conta
2. Confirmar e-mail (se exigido)
3. Entrar
4. Cadastrar empresa
5. Cadastrar funcionário
6. Adicionar crédito e débito
7. Conferir dashboard/histórico
8. Cadastrar WhatsApp e testar envio
9. Subir logo
10. Fazer deploy da Edge Function e testar convite

## Segurança

- Todas as tabelas de negócio têm RLS.
- Uma empresa não consegue consultar linhas de outra empresa pelas políticas do banco.
- `user_metadata` não é usado para autorização.
- Secret Key/service_role não é exposta no frontend.
- A auditoria registra alterações em funcionários e lançamentos.
- A exclusão visual de funcionário usa inativação para preservar histórico.

## Observação legal

Este software ajuda a controlar banco de horas, mas regras de jornada e banco de horas dependem da legislação, acordos e convenções aplicáveis. Antes de comercializar como ferramenta oficial de RH/ponto, faça validação jurídica e trabalhista para o público-alvo.
