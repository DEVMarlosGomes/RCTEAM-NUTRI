# Plano de Acao - Gap entre PLANILHA EVONUT e RCTEAM-NUTRI

## Objetivo

Mapear o que a `PLANILHA EVONUT.XLSM` oferece e o que ainda nao esta efetivamente entregue no sistema atual, para priorizar a evolucao do produto e deixar a operacao do personal o mais proximo possivel da planilha.

## Resumo Executivo

A base atual ja cobre parte importante do fluxo clinico:

- anamnese estruturada
- antropometria com calculos principais
- exames manuais e por PDF
- calculos de TMB, GET e venta
- plano alimentar manual e por IA
- recordatorio alimentar
- base de alimentos e medidas
- PDFs clinicos basicos

O problema nao esta so em "faltar dados". O principal gap hoje e de **profundidade funcional**:

- algumas abas da planilha ainda nao existem como modulo no sistema
- outras existem no backend/schema, mas a UX entregue esta simplificada
- em alguns pontos a base usada na interface nao e a mesma base rica que ja existe no backend

## O que a planilha cobre

Principais blocos identificados na planilha:

- `BD ANAMNESE`
- `BD RECORDATORIO`
- `BD EXAMES_1` e `BD EXAMES_2`
- `BD ANTROPOMETRIA`
- `BD GASTO_ENERG`
- `BD DIST_MACROS`
- `BD CALC_DIETA`
- `BD ALIMENTOS`
- `BD MEDIDAS`
- `BD EQUIVALENTES`
- `BD PLANOS_SALVOS`
- `BD ANÁLISES`
- `BD ORIENTAÇÕES`

Os blocos mais "pesados" da planilha sao:

- antropometria com multiplos perfis e referencias
- calculo detalhado da dieta por refeicao
- equivalentes alimentares
- analises de adequacao
- historico de planos salvos
- orientacoes nutricionais prontas para prescricao

## O que ja existe no sistema

### Entregue com uso real

- area do nutricionista com paciente detalhado
- anamnese estruturada por secoes
- antropometria com protocolos de dobras, perimetria e evolucao
- gasto energetico com TMB, GET, FI, NAF e venta
- exames por PDF e exames manuais
- plano alimentar IA
- plano alimentar manual com busca de alimentos
- recordatorio
- PDFs de anamnese, antropometria, exames e plano manual

### Base de dados ja existente

- `backend/evonut_database.json` contem:
  - `6592` alimentos
  - `25` medidas caseiras
  - `12` protocolos TMB
  - `5` opcoes NAF
  - `27` fatores de injuria
  - `16` grupos alimentares

### Sinal de inconsistencia atual

- a tela de alimentos e a de rotulos usam `frontend/public/data/cadastro_alimentos_evonut.csv`
- esse CSV publico tem apenas `20` linhas
- o backend ja possui base muito maior com `6592` alimentos

Isso indica que parte da interface ainda esta operando com uma base demonstrativa, nao com a base principal do sistema.

## Gaps reais entre planilha e sistema

### P0 - Gaps que bloqueiam aderencia operacional

#### 1. Equivalentes alimentares nao existem como modulo do sistema

Na planilha existe a aba `BD EQUIVALENTES`, com substituicoes por alimento, medida e quantidade.

Hoje o sistema nao tem:

- CRUD de equivalentes
- sugestao de substituicao dentro do plano
- troca automatica por equivalencia nutricional
- visualizacao de opcoes equivalentes por refeicao

Impacto:

- o personal perde uma das funcoes mais praticas da planilha
- planos ficam menos flexiveis
- atendimento consome mais tempo manual

#### 2. Orientacoes nutricionais nao existem como produto utilizavel

A planilha possui `BD ORIENTAÇÕES`.

Hoje nao ha modulo completo para:

- cadastrar orientacoes padrao
- categorizar orientacoes
- anexar orientacoes ao plano
- imprimir orientacoes junto com o material do paciente
- permitir biblioteca reutilizavel por objetivo ou caso clinico

Embora haja schema para orientacoes, isso nao esta entregue como fluxo principal.

#### 3. Calculo dietetico por refeicao ainda esta abaixo da planilha

A planilha `BD CALC_DIETA` trabalha refeicao por refeicao, medida por medida, com calculo detalhado de varios nutrientes.

No sistema atual:

- o plano IA entrega texto, nao estrutura operacional equivalente a planilha
- o plano manual e melhor, mas ainda e mais enxuto que a planilha
- faltam metas por refeicao, saldo por refeicao e quadro completo de adequacao
- nao existe tela equivalente ao painel denso de calculo da dieta

Impacto:

- o sistema ainda nao substitui a planilha para montagem clinica fina

#### 4. Recordatorio no front-end esta simplificado demais

O schema/backend foi desenhado para calculo rico, mas a tela atual de recordatorio permite criar itens digitando nome e quantidade manualmente.

Faltam na experiencia:

- busca integrada na base de alimentos
- selecao de medida caseira
- conversao automatica para gramas durante a digitacao
- visualizacao completa dos micronutrientes e adequacao DRI
- reaproveitamento do recordatorio como base para plano

Impacto:

- existe backend/modelagem, mas a usabilidade ainda nao espelha a planilha

### P1 - Gaps clinicos importantes

#### 5. Antropometria ainda nao cobre toda a profundidade da planilha

A planilha de antropometria e muito mais ampla, com:

- referencias por perfil
- percentis
- infantil/adolescente
- idoso
- gestante
- bioimpedancia
- varias impressoes especificas

O sistema atual cobre bem o nucleo adulto, mas ainda falta:

- fluxo completo infantil/adolescente com percentis dedicados
- fluxo gestacional completo
- bioimpedancia estruturada
- mais layouts especificos de impressao
- possivel ampliacao dos protocolos e classificacoes

#### 6. Gasto energetico esta parcial frente a planilha

A planilha possui:

- varios protocolos TMB
- fatores de injuria mais detalhados
- NAF por sexo/faixa
- atividades por METs

No sistema ja ha calculo de TMB/GET/FI/NAF, mas ainda faltam:

- seletor mais completo dos protocolos existentes na base
- uso clinico dos METs em fluxo de tela
- persistencia e historico do gasto energetico como entidade propria
- prescricao energetica mais conectada ao plano manual

#### 7. Exames laboratoriais ainda nao espelham o painel da planilha

A planilha organiza exame, grupo, unidade, referencias e resultado de forma muito ampla.

Hoje o sistema ja faz:

- PDF com IA
- cadastro manual por catalogo

Mas ainda faltam:

- timeline longitudinal de exames com comparacao entre coletas
- filtros por grupo
- painel de alteracoes recorrentes
- impressao mais parecida com o ecossistema da planilha
- integracao mais forte com analise clinica e plano

### P2 - Gaps de consistencia de dados e UX

#### 8. Base de alimentos esta desalinhada entre backend e frontend

Hoje ha duas realidades:

- backend rico com milhares de alimentos
- frontend publico/restrito usando CSV curto para algumas telas

Isso precisa ser unificado.

#### 9. Medidas caseiras nao estao como modulo vivo

Existe exibicao da base de medidas, mas ainda falta:

- CRUD real de medidas
- gestao de medidas por alimento
- validacao de conversoes criticas
- uso consistente dessa base em todos os modulos

#### 10. Historico de planos salvos ainda nao replica a logica da planilha

A planilha tem `BD PLANOS_SALVOS`.

No sistema ha listagem de planos manuais e versao de plano IA, mas ainda faltam:

- snapshot versionado completo
- comparacao entre versoes
- clonagem de plano
- reutilizacao de plano salvo como template
- relacao clara entre avaliacao, meta e versao

#### 11. Analises de adequacao ainda nao viraram modulo visivel

A planilha tem `BD ANÁLISES`.

Falta transformar isso em tela e regra de negocio visivel:

- adequacao do plano versus meta
- adequacao de micronutrientes
- alerta de excesso ou deficiencia
- leitura consolidada por refeicao e dia

## Plano de Acao Recomendado

### Fase 1 - Fechar o gap funcional central

1. Unificar a base alimentar usada pelo sistema
2. Reescrever o recordatorio para usar alimentos + medidas caseiras + calculo automatico
3. Evoluir o plano manual para refletir metas por refeicao, saldo e distribuicao de macros
4. Criar modulo de equivalentes alimentares

Resultado esperado:

- o nutricionista consegue montar dieta e recordatorio sem voltar para a planilha

### Fase 2 - Fechar o gap clinico

1. Ampliar antropometria para infantil, gestante e bioimpedancia
2. Completar gasto energetico com protocolos/fatores/mets da base
3. Evoluir exames para comparativo longitudinal e analise por grupos
4. Criar modulo de analises de adequacao

Resultado esperado:

- a leitura clinica do paciente fica mais proxima da inteligencia operacional da planilha

### Fase 3 - Fechar o gap de prescricao e historico

1. Criar modulo de orientacoes nutricionais
2. Criar historico versionado real de planos
3. Permitir duplicar planos e aplicar templates
4. Ampliar PDFs e impressos por tipo de consulta/perfil

Resultado esperado:

- o sistema substitui tambem a parte de entrega e reaproveitamento da planilha

## Backlog priorizado

### Prioridade maxima

- unificar alimentos backend/frontend
- recordatorio com busca de alimento e medida caseira
- calculo dietetico detalhado por refeicao
- equivalentes alimentares

### Prioridade alta

- orientacoes nutricionais
- analise de adequacao de macros e micros
- historico de planos salvos com comparacao
- gasto energetico completo

### Prioridade media

- antropometria infantil/gestacional/bioimpedancia
- exames com comparativo longitudinal
- novos PDFs e layouts de impressao

## Ordem tecnica sugerida

1. Revisar e consolidar o contrato da base alimentar
2. Reestruturar `recordatorio` e `plano manual` em cima dessa base
3. Entregar `equivalentes`
4. Entregar `analises`
5. Entregar `orientacoes`
6. Expandir `antropometria`, `gasto energetico` e `exames`
7. Finalizar `historico/versionamento` e impressos

## Conclusao

O sistema ja tem um nucleo bom, mas ainda nao substitui a planilha em tres pontos centrais:

- montagem nutricional detalhada
- flexibilidade operacional do consultorio
- profundidade de analise e reaproveitamento

Se fosse para resumir o gap em uma frase:

> a base conceitual da planilha ja entrou no projeto, mas os modulos mais valiosos dela ainda nao viraram experiencia completa e integrada no sistema.

## Status Atual em 2026-08-03

Fase 1: concluida

- base alimentar operacional integrada no fluxo clinico
- recordatorio refeito com alimentos, medidas e calculo
- plano manual evoluido com metas, saldos e distribuicao
- estrutura inicial de equivalentes entregue

Fase 2: concluida

- antropometria expandida para novos perfis clinicos prioritarios
- gasto energetico ampliado com protocolos e fatores da base
- exames evoluidos com comparativo e leitura agrupada
- analises de adequacao incorporadas ao fluxo

Fase 3: concluida funcionalmente

- modulo de orientacoes nutricionais entregue
- historico versionado real de planos entregue
- duplicacao e aplicacao de templates entregues
- PDF do plano alimentar ampliado com contexto clinico, versao, origem e melhor organizacao visual

Pendencia residual pos-fase 3:

- rodada final de homologacao visual e operacional com uso real do nutricionista
