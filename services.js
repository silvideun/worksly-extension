// access: 'open' | 'partial' | 'vpn'
//   open    - доступен без VPN стабильно
//   partial - нестабильно/частично: замедление РКН либо перебои на стороне сервиса (причина - в accessNote)
//   vpn     - заблокирован или намеренно гео-ограничен, нужен VPN
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
    accessNote:'Сайт и лаунчер работают без VPN с любых провайдеров РФ.',
    payNote:'Карты РФ напрямую не работают. Работает пополнение через сторонние сервисы или подарочные карты.',
    vpnPartner:null
  },
  {
    id:'netflix', icon:'icons/netflix.svg', name:'Netflix', sub:'Стриминг',
    domain:'www.netflix.com',
    access:'vpn',
    pay:'mid',
    accessNote:'Полный блок из РФ. Вход и просмотр только через VPN.',
    payNote:'Прямой оплаты картой РФ нет. Посредник оформляет новый аккаунт с подпиской или продлевает уже имеющийся иностранный аккаунт.',
    payPartner:{ badge:'Проверенный сервис', name:'ggsel.net', url:'', note:'Оформление и продление подписки Netflix с оплатой картой РФ.' },
    vpnPartner:{ badge:'Проверенный сервис', name:'VPN Trust', url:'', note:'Стабильный VPN для доступа и регистрации, оплата картой РФ.' }
  },
  {
    id:'chatgpt', icon:'icons/openai.svg', name:'ChatGPT Plus', sub:'Подписка OpenAI',
    domain:'chatgpt.com',
    access:'vpn',
    pay:'mid',
    accessNote:'OpenAI официально ушёл из РФ и блокирует доступ по российскому IP на уровне сервиса - блокировка не сетевая, а от самого OpenAI, поэтому нужен VPN в любую страну кроме РФ/РБ.',
    payNote:'Бесплатная версия оплаты не требует - достаточно VPN. Для приобретения подписки нужен посредник.',
    payPartner:{ badge:'Проверенный сервис', name:'ggsel.net', url:'', note:'Оформление подписок и цифровых сервисов с оплатой картой РФ.' },
    vpnPartner:{ badge:'Проверенный сервис', name:'VPN Trust', url:'', note:'Нужен для входа на сайт и регистрации аккаунта.' }
  },
  {
    id:'discord', icon:'icons/discord.svg', name:'Discord', sub:'Мессенджер и войс-чаты',
    domain:'discord.com',
    access:'partial',
    pay:'mid',
    accessNote:'Доступность нестабильна и зависит от провайдера - у части пользователей сайт и голосовые каналы работают без VPN, у части полностью заблокированы. Для гарантированного результата рекомендуем VPN.',
    payNote:'Карты РФ для Nitro не проходят. Оформление - через посредника или подарочный код.',
    payPartner:{ badge:'Проверенный сервис', name:'ggsel.net', url:'', note:'Оформление Discord Nitro с оплатой картой РФ.' },
    vpnPartner:{ badge:'Проверенный сервис', name:'VPN Trust', url:'', note:'Нужен для стабильного доступа к сайту и голосовым каналам.' }
  },
  {
    id:'playstation', icon:'icons/playstation.svg', name:'PlayStation Store', sub:'Игры для PS5/PS4',
    domain:'store.playstation.com',
    access:'vpn',
    pay:'mid',
    accessNote:'Сайт открывается без VPN. Регистрация аккаунта с российским регионом заблокирована Sony (не провайдером) - для неё нужен VPN.',
    payNote:'Карты РФ не привязать к PSN ни в одном регионе. Пополнение - только через подарочные карты нужного региона.',
    payPartner:{ badge:'Проверенный сервис', name:'ggsel.net', url:'', note:'Подарочные карты PSN нужного региона с оплатой картой РФ.' },
    vpnPartner:{ badge:'Проверенный сервис', name:'VPN Trust', url:'', note:'Нужен для смены региона аккаунта и доступа к магазину.' }
  },
  {
    id:'spotify', icon:'icons/spotify.svg', name:'Spotify', sub:'Музыкальный стриминг',
    domain:'open.spotify.com',
    access:'partial',
    pay:'mid',
    accessNote:'Официально ушёл из РФ в марте 2022 года, но доступность нестабильна и зависит от провайдера - у части пользователей открывается и без VPN. Для стабильного доступа и регистрации аккаунта нужен VPN.',
    payNote:'Карты РФ не принимаются. Premium оформляется через подарочный код или посредника.',
    payPartner:{ badge:'Партнёрский сервис', name:'ggsel.net', url:'', note:'Подарочные коды Spotify Premium с оплатой картой РФ.' },
    vpnPartner:{ badge:'Проверенный сервис', name:'VPN Trust', url:'', note:'Нужен для доступа к сервису и регистрации аккаунта.' }
  },
  {
    id:'xbox', icon:'icons/xbox.svg', name:'Xbox', sub:'Игры и подписка Game Pass',
    domain:'www.xbox.com',
    access:'open',
    pay:'mid',
    accessNote:'Сайт и сетевые сервисы (мультиплеер, достижения) работают без VPN. Ранее купленные игры запускаются без ограничений.',
    payNote:'Магазин в РФ закрыт, карты РФ не работают. Пополнение и подписки (Game Pass) оформляются через ключи или подарочные карты других регионов.',
    payPartner:{ badge:'Проверенный сервис', name:'ggsel.net', url:'', note:'Ключи активации Xbox Game Pass, подписок и игр с оплатой картой РФ.' },
    vpnPartner:null
  },
  {
    id:'telegram', icon:'icons/telegram.svg', name:'Telegram', sub:'Мессенджер и Premium',
    domain:'web.telegram.org',
    access:'vpn',
    pay:'mid',
    accessNote:'Сервис заблокирован в РФ и ограничен мерами РКН. Для стабильного подключения, звонков и загрузки медиа требуется VPN или прокси.',
    payNote:'Прямой оплаты картой РФ нет. Оплата через бота @PremiumBot может сбоить. Для гарантированного оформления подписки используют подарочные коды или посредников.',
    payPartner:{ badge:'Проверенный сервис', name:'ggsel.net', url:'', note:'Подарочные коды и оформление Telegram Premium с оплатой картой РФ.' },
    vpnPartner:{ badge:'Проверенный сервис', name:'VPN Trust', url:'', note:'Нужен для стабильного подключения, звонков и загрузки медиа без ограничений.' }
  }
];
