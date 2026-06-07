# 24hApp - Monitoramento de Localização em Tempo Real (Estilo Life360)

Este é um Progressive Web App (PWA) de alta performance e visual premium projetado para rastrear e compartilhar a localização em tempo real entre dois celulares 24h por dia.

## Recursos Integrados
- 🗺️ **Mapa Interativo (Dark Mode):** Utiliza Leaflet.js com tiles escurecidos e rotas históricas pontilhadas.
- ⚡ **Sincronização em Tempo Real:** Comunicação via Socket.io com baixíssima latência.
- 🔋 **Monitoramento de Bateria:** Mostra a porcentagem e estado de carga do parceiro.
- 🏠 **Status Rápido:** Defina o que está fazendo com emojis ("Em Casa", "Trânsito", "Trabalho", etc.).
- 🆘 **Alerta de Emergência (SOS):** Dispara uma sirene nativa (sintetizador de áudio) no celular do parceiro com overlay vermelho piscante.
- 💾 **Persistência Local (SQLite):** Histórico de rotas salvo nativamente utilizando o módulo experimental superleve `node:sqlite` do Node 22+.
- 📱 **Pronto para Instalação (PWA):** Instale diretamente na tela inicial do celular como aplicativo.

---

## Como Rodar o Servidor

1. Abra um terminal na pasta do projeto e inicie o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```
2. O servidor estará rodando em:
   - No computador: **`http://localhost:3333`**

---

## Como Acessar e Testar nos Celulares (Rede Local)

Para o rastreamento em tempo real funcionar entre dois aparelhos separados, ambos devem acessar o servidor.

1. **Descubra o IP do seu computador na rede local (Wi-Fi):**
   - No Windows, abra o PowerShell ou Prompt de Comando e digite:
     ```powershell
     ipconfig
     ```
   - Procure por `Endereço IPv4` na sua placa de rede ativa (ex: `192.168.1.100` ou `10.0.0.15`).
2. **Acesse no celular:**
   - Digite no navegador do celular: **`http://<IP-DO-SEU-COMPUTADOR>:3333`** (exemplo: `http://192.168.1.100:3333`).
   - *Importante:* Ambos os celulares devem estar conectados no mesmo Wi-Fi do computador.

---

## Configuração 24h em Segundo Plano (Background)

Devido às restrições agressivas de economia de bateria dos navegadores móveis, siga estas diretrizes para garantir o rastreamento 24h:

### 📱 Android
1. **Instalar como PWA:** No Chrome, clique no botão de instalação no app ou nos três pontinhos -> **Adicionar à tela inicial**.
2. **Remover restrição de Bateria:** Pressione e segure o ícone do app na tela inicial -> **Informações do app (Info)** -> **Bateria** -> Mude de "Otimizado" para **"Sem restrições"**.
3. **Permissões de GPS:** Garanta que a permissão de localização esteja definida como "Permitir durante o uso do app".

### 🍎 iOS (iPhone)
1. **Instalar como PWA:** No Safari, clique no botão de **Compartilhar** (ícone de seta para cima) -> Role até o final e selecione **"Adicionar à Tela de Início"**. Abra o app por este novo ícone.
2. **Atualização em 2º Plano:** Vá em Ajustes -> Geral -> **Atualização em 2º Plano** e certifique-se de que está ativa para o Safari / Tela de Início.
3. **Manter Tela Ligada (Wake Lock):** Se estiver se deslocando e precisar de rastreamento contínuo garantido de 100%, ative o interruptor **"Modo Wake Lock (Tela Ativa)"** no app.
