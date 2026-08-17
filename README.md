# BancoHora Pro 2.1

Sistema SaaS multiempresa para gestão de banco de horas com Supabase.

## O que funciona nesta versão

- Cadastro e login com Supabase Auth
- Confirmação de e-mail e recuperação de senha
- Cadastro da empresa no primeiro acesso
- Separação de dados por empresa com RLS
- Proprietário, Administrador e Responsável pelas horas
- Cadastro, edição, inativação, reativação e exclusão definitiva de funcionário
- CPF, matrícula, cargo, setor, WhatsApp, e-mail e data de admissão
- Saldo inicial em horas e minutos
- Crédito e débito de banco de horas
- Edição e exclusão de lançamentos por proprietário/administrador
- Histórico individual
- Dashboard e saldos atualizados
- Pesquisa e filtros
- WhatsApp individual
- Resumo geral de todos os funcionários em uma única mensagem
- Relatório por período, setor e situação
- Impressão / PDF pelo navegador
- Upload da logo da empresa
- Convite de usuário/RH por e-mail
- Sincronização em tempo real entre usuários
- Layout responsivo para celular e computador

## Banco de dados

O arquivo `supabase/schema.sql` contém o schema completo para uma instalação nova.

O arquivo `supabase/fix_2_1.sql` contém somente a atualização da versão 2.1 para projetos que já estavam instalados.

No projeto BancoHora Pro conectado durante o desenvolvimento, a atualização 2.1 já foi aplicada no Supabase.

## GitHub Pages

O `index.html` deve ficar na raiz do repositório. A estrutura deve ser:

```text
BancoHora-Pro/
├── index.html
├── README.md
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   └── config.js
└── supabase/
    ├── schema.sql
    ├── fix_2_1.sql
    └── functions/
        └── invite-company-user/
            └── index.ts
```

## Segurança

A chave no `js/config.js` é a Publishable Key. Não coloque `service_role`, `sb_secret_...`, senha do banco ou qualquer outra chave secreta no GitHub.
