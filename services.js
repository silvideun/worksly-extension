// access: 'open' | 'partial' | 'block'
//   open    - сайт открывается из РФ напрямую стабильно. Ось только про доступ по IP:
//             ограничения на уровне аккаунта (пример - PlayStation Store: играть с РФ-айпи можно,
//             купить с российским аккаунтом нельзя) объясняются в desc, а не понижают эту ось
//   partial - нестабильно/частично: ограничения или перебои на стороне провайдера/сервиса (причина - в accessNote)
//   block   - сайт из РФ не открывается: заблокирован либо сам сервис ограничил доступ с российских IP
// pay: 'ok' | 'mid'
//   ok  - карта РФ принимается сервисом напрямую
//   mid - напрямую нельзя, но посредник решает вопрос (своей картой/аккаунтом), вы платите ему картой РФ
//
// domain: используется и для клиентского пинга, и для серверного чекера (server/domains.json).
// При добавлении нового сервиса - не забыть продублировать домен в manifest.json → host_permissions,
// иначе chrome.webRequest не увидит запросы к нему (клиентский пинг для него не заработает).

export const SERVICES = [
  {
    id:'steam', icon:'icons/steam.svg', name:'Steam', sub:'Игры и достижения',
    domain:'store.steampowered.com',
    access:'open',
    pay:'mid',
    desc:'Пополнение кошелька и покупка происходят через сторонние сервисы или посредников.',
    accessNote:'Сайт и лаунчер работают напрямую с любых провайдеров РФ.',
    payNote:'Карты РФ напрямую не работают. Работает пополнение через сторонние сервисы или подарочные карты.',
    payPartners:[
      { name:'Playerok', desc:'Пополнение баланса Steam', url:'https://playerok.com/steam/top-up', isPartner:false },
      { name:'ggsel.net', desc:'Покупка ключей и гифтов игр', url:'https://ggsel.net/catalog/steam-games', isPartner:false }
    ]
  },
  {
    id:'netflix', icon:'icons/netflix.svg', name:'Netflix', sub:'Стриминг',
    domain:'www.netflix.com',
    access:'block',
    pay:'mid',
    desc:'Посредник либо оформляет новый аккаунт с подпиской, либо продлевает уже существующий иностранный. Для доступа к сервису требуется зарубежное подключение.',
    accessNote:'Прямой доступ из РФ заблокирован.',
    payNote:'Прямой оплаты картой РФ нет. Посредник оформляет новый аккаунт с подпиской или продлевает уже имеющийся иностранный аккаунт.',
    payPartners:[
      { name:'ggsel.net', desc:'Покупка и продление подписки', url:'https://ggsel.net/catalog/netflix', isPartner:false }
    ]
  },
  {
    id:'chatgpt', icon:'icons/openai.svg', name:'ChatGPT Plus', sub:'Подписка OpenAI',
    domain:'chatgpt.com',
    access:'block',
    pay:'mid',
    desc:'Блокировка установлена самим OpenAI на уровне сервиса для пользователей из РФ и Беларуси. Для оплаты подписки потребуется посредник.',
    accessNote:'OpenAI официально прекратил работу в РФ и блокирует доступ по российскому IP на уровне сервиса.',
    payNote:'Для приобретения платной подписки Plus потребуется посредник.',
    payPartners:[
      { name:'Playerok', desc:'Покупка подписки ChatGPT Plus', url:'https://playerok.com/cgpt/subscription', isPartner:false }
    ]
  },
  {
    id:'discord', icon:'icons/discord.svg', name:'Discord', sub:'Мессенджер и войс-чаты',
    domain:'discord.com',
    access:'partial',
    pay:'mid',
    desc:'Доступность нестабильна и зависит от провайдера. Nitro и другие покупки оформляются только через посредника.',
    accessNote:'Доступность нестабильна и зависит от провайдера — у части пользователей сайт и голосовые каналы открываются напрямую, у части соединение заблокировано.',
    payNote:'Карты РФ для Nitro не проходят. Оформление - через посредника или подарочный код.',
    payPartners:[
      { name:'ggsel.net', desc:'Покупка подписки Discord Nitro', url:'https://ggsel.net/catalog/discord-nitro', isPartner:false }
    ]
  },
  {
    id:'playstation', icon:'icons/playstation.svg', name:'PlayStation Store', sub:'Игры для PS5/PS4',
    domain:'store.playstation.com',
    access:'open',
    pay:'mid',
    desc:'Российский аккаунт покупать не может — витрина скрыта. Нужен аккаунт другого региона: с ним можно играть и скачивать с российского IP, а пополнять — подарочными картами того же региона или через посредника.',
    accessNote:'Сайт открывается напрямую. Регистрация аккаунта с российским регионом заблокирована Sony.',
    payNote:'Карты РФ не привязать к PSN ни в одном регионе. Пополнение - только через подарочные карты нужного региона.',
    payPartners:[
      { name:'ggsel.net', desc:'Пополнение баланса и подарочные карты PSN', url:'https://ggsel.net/catalog/psn', isPartner:false }
    ]
  },
  {
    id:'spotify', icon:'icons/spotify.svg', name:'Spotify', sub:'Музыкальный стриминг',
    domain:'open.spotify.com',
    access:'partial',
    pay:'mid',
    desc:'Ушёл из РФ в 2022 году, но у части провайдеров открывается напрямую. В десктопном приложении прямое подключение доступно после авторизации. Premium оформляется через посредника.',
    accessNote:'Официально ушёл из РФ в марте 2022 года, но доступность нестабильна и зависит от провайдера — у части пользователей открывается напрямую.',
    payNote:'Карты РФ не принимаются. Premium оформляется через подарочный код или посредника.',
    payPartners:[
      { name:'Playerok', desc:'Покупка подписки Spotify Premium', url:'https://playerok.com/spotify/subscription', isPartner:false }
    ]
  },
  {
    id:'xbox', icon:'icons/xbox.svg', name:'Xbox', sub:'Игры и подписка Game Pass',
    domain:'www.xbox.com',
    access:'open',
    pay:'mid',
    desc:'Ранее купленные игры и сетевые сервисы работают без ограничений. На российский регион покупать нельзя: подписки Game Pass и игры оформляются через ключи активации или подарочные карты других регионов.',
    accessNote:'Сайт и сетевые сервисы (мультиплеер, достижения) работают напрямую. Ранее купленные игры запускаются без ограничений.',
    payNote:'Магазин в РФ закрыт, карты РФ не работают. Пополнение и подписки (Game Pass) оформляются через ключи или подарочные карты других регионов.',
    payPartners:[
      { name:'Plati.Market', desc:'Покупка подписки Xbox Game Pass', url:'https://plati.market/games/xbox-microsoft-store/192/', isPartner:false }
    ]
  },
  {
    id:'telegram', icon:'icons/telegram.svg', name:'Telegram', sub:'Мессенджер и Premium',
    domain:'web.telegram.org',
    access:'block',
    pay:'mid',
    payBoxNote:'Платёж картой РФ проходит не всегда',
    desc:'Прямой доступ ограничен на уровне провайдеров. Premium и Звёзды оплачиваются картой РФ прямо в приложении, но платёж проходит не всегда.',
    accessNote:'Сервис ограничен мерами регулирования и у части операторов не открывается по прямому подключению.',
    payNote:'Прямой оплаты картой РФ нет. Оплата через бота @PremiumBot может сбоить. Для гарантированного оформления подписки используют подарочные коды или посредников.',
    payPartners:[
      { name:'Playerok', desc:'Покупка подписки Telegram Premium', url:'https://playerok.com/telegram/premium', isPartner:false }
    ]
  }
];
