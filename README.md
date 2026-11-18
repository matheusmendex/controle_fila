# E6-FILA

App Android em Expo, painel público para a sala de espera e API Node.js ligada ao Supabase. A API também atende o totem ESP32 do projeto. O caminho recomendado é usar HTTPS no Railway.

## 1. Criar o banco Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor → New query**.
3. Copie e execute o conteúdo completo de [`server/supabase/schema.sql`](server/supabase/schema.sql).
4. Na janela **Connect** do Supabase, copie a **Project URL** e a **secret key** (`sb_secret_...`). Ela fica somente no servidor; nunca a coloque no app. Supabase está migrando do nome antigo `service_role` para `secret`; o backend aceita os dois nomes.

O SQL cria tabelas, índices, controle de duplicidade do ESP32, funções transacionais para emitir/chamar senhas, fila prioritária com limite de duas prioridades seguidas, guichê inicial `G01` e permissões fechadas para acesso direto pelo app. Copie a chave secreta (`sb_secret_...`) para o servidor. Não use a chave publishable (`sb_publishable_...`) nessa variável e não coloque a secret key no app.

Se você já executou uma versão anterior do `schema.sql`, execute de novo o arquivo atualizado: ele adiciona a estrutura de solicitações de teste remoto de forma segura para repetição.

## 2. Preparar a API

O arquivo `server/.env` já está criado com os nomes das variáveis e valores de exemplo. Substitua os valores indicados:

| Variável | O que colocar |
| --- | --- |
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_SECRET_KEY` | Chave secreta de backend (`sb_secret_...`) do Supabase |
| `JWT_SECRET` | Segredo aleatório com ao menos 32 caracteres |
| `DEVICE_KEY` | Chave longa aleatória; use o mesmo valor no arquivo do ESP32 |
| `BOOTSTRAP_PASSWORD` | Senha inicial do atendente, com pelo menos 10 caracteres |
| `BOOTSTRAP_USERNAME` | Usuário inicial do atendente |

`PORT`, `DEVICE_ID`, `CORS_ORIGIN`, `BOOTSTRAP_ATTENDANT_NAME` e `BOOTSTRAP_DESK_CODE` já têm valores adequados para a primeira execução. O guichê `G01` é criado pelo SQL.

Para gerar os dois segredos com Node.js, execute o comando abaixo duas vezes e use um valor em `JWT_SECRET` e outro em `DEVICE_KEY`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

```powershell
cd server
npm install
npm run setup:initial
npm start
```

O comando inicial registra o dispositivo e cria/atualiza o usuário com hash bcrypt. Teste `http://localhost:3000/health` antes do deploy.

### Publicar no Railway

Crie um serviço Railway ligado à pasta/repositório `server`, usando `npm start`. Cadastre no Railway todas as variáveis do `server/.env.example` com os valores reais e execute `npm run setup:initial` uma vez com essas variáveis. O Railway define `PORT` automaticamente. Depois do deploy, copie o domínio HTTPS público, por exemplo `https://e6-fila-api.up.railway.app`.

## 3. Configurar e gerar o APK

O arquivo `.env` deste app já está criado. Cole o domínio HTTPS da API em `EXPO_PUBLIC_API_URL`. Para builds na nuvem, crie também a variável `EXPO_PUBLIC_API_URL` no ambiente `preview` do EAS (e no `production` se publicar na loja). Essa é uma URL pública; nenhuma chave do Supabase ou do dispositivo vai para o app.

```powershell
npm install
npx expo start
```

Para gerar o APK de instalação interna:

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value https://SEU-SERVICO.up.railway.app --environment preview --visibility plaintext
npx eas-cli@latest build --platform android --profile preview
```

`eas.json` já está configurado para produzir APK no perfil `preview`. O comando `eas init` associa o projeto à sua conta Expo e grava o identificador EAS do projeto.

## 4. Integrar o totem ESP32

O arquivo `fireware/E6Fila/secrets.h` também está criado. Preencha o Wi-Fi, o domínio HTTPS da API e replique exatamente `DEVICE_ID` e `DEVICE_KEY` do `.env` do servidor. Instale no Arduino IDE as bibliotecas ArduinoJson, Adafruit GFX e Adafruit SSD1306. Grave o sketch `fireware/E6Fila/E6Fila.ino` no ESP32.

O sketch usa `WiFiClientSecure::setInsecure()` para permitir a conexão HTTPS sem instalar um certificado CA, conforme o guia. O tráfego fica criptografado, mas o ESP32 não valida a identidade do servidor; para uso real, substitua por `setCACert()` com a CA raiz adequada.

## Telas e rotas da API

- **Início**: abre o painel do atendente, o painel público ou o acompanhamento por código de senha.
- **Atendente**: login, estado do ESP32, emissão de senhas de teste sem hardware, chamar, repetir, iniciar, finalizar, ausente, histórico e indicadores.
- **Painel público**: atualiza a cada 3 segundos e mostra a senha chamada, guichê e quatro chamadas anteriores.
- **Acompanhar senha**: consulta a posição aproximada pelo código impresso.
- **API**: `POST /api/eventos`, `POST /api/atendimento/simular`, `GET /api/comandos/pendentes`, `POST /api/comandos/:id/confirmacao`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/atendimento/chamar-proxima`, `POST /api/atendimento/:id/acao`, `GET /api/dashboard` e `GET /api/tickets/:codigo`.

## Variáveis que ficam em cada lugar

- **Supabase SQL Editor**: conteúdo de `server/supabase/schema.sql`.
- **Railway**: variáveis do `server/.env.example`; somente o servidor recebe a chave `service_role`.
- **Expo local/EAS**: `EXPO_PUBLIC_API_URL` com o domínio HTTPS da API.
- **ESP32**: Wi-Fi, URL da API e cópia da `DEVICE_KEY` em `secrets.h`.
