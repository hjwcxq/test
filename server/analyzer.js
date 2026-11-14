/**
 * 本地结构化启发式剖析引擎（纯函数，完全离线可用）。
 *
 * 不依赖任何外部模型：通过题面特征词与句式模式识别题型，抽取核心概念与
 * 限制条件，再按题型模板组合生成分层立意、分段提纲、素材方向与风险提示。
 * 输出结构固定，便于前端渲染与单元测试。
 */

export const MAX_TOPIC_LENGTH = 2000;

export const QUESTION_TYPES = {
  relation: {
    code: 'relation',
    name: '思辨关系类',
    summary: '题面包含两难、比较、反问或观点对立，要求辨析概念之间的关系并给出自己的判断。',
  },
  phenomenon: {
    code: 'phenomenon',
    name: '现象评论类',
    summary: '题面描述一种普遍的社会或生活现象，要求解释其成因、辨析利弊并作出评价。',
  },
  quotation: {
    code: 'quotation',
    name: '名言警句类',
    summary: '题面以引语、格言或他人观点为核心，要求界定其含义、限定其成立条件并展开思考。',
  },
  growth: {
    code: 'growth',
    name: '成长体验类',
    summary: '题面围绕个人经历、青春记忆或自我变化，要求从具体体验中提炼出普遍认识。',
  },
};

// 每条规则命中一次即计入权重，命中依据会被记录进 reason，便于向用户解释判定。
const DETECTION_RULES = [
  {
    code: 'quotation',
    patterns: [
      { re: /[「『“"'‘][^」』”"'’]{4,}[」』”"'’]/, weight: 6, label: '含带引号的引述语句' },
      { re: /有人说|曾言|曾说|有言|名言|警句|俗话说|正如.{0,10}所说|鲁迅|苏格拉底|康德|尼采|庄子|孔子|孟子|苏轼|王阳明|爱因斯坦|培根|莎士比亚|泰戈尔|加缪/, weight: 5, label: '含引用引导词或思想人物' },
      { re: /这句话|这番话|这段话|引发了你|给你怎样的(启示|思考)/, weight: 3, label: '含对引语的回指与追问' },
    ],
  },
  {
    code: 'growth',
    patterns: [
      { re: /成长|青春|童年|少年|记忆|经历|那一刻|第一次|陪伴|挫折|蜕变|足迹|毕业|我与|我的故事/, weight: 5, label: '含成长经历与自我体验词' },
      { re: /请以.{0,14}为(题|话题)|记述|叙写|写一段经历|分享你的(故事|经历)/, weight: 4, label: '含叙事/命题作文指令' },
    ],
  },
  {
    code: 'phenomenon',
    patterns: [
      { re: /如今|当下|生活中|现实里|越来越|日益|这一现象|这种现象|普遍|常见|往往|许多人|不少人|人们常|社交媒体|社交平台|网络时代|短视频|人工智能|算法|内卷|刷屏|流行/, weight: 4, label: '含社会/生活现象描述词' },
      { re: /对此你怎么看|如何看待这(一|种)?现象|这一现象|这种现象|你如何看待/, weight: 4, label: '含现象评论指令' },
      { re: /人们(常|往往|总|喜欢|习惯|更愿意)|大家(都|总)/, weight: 3, label: '含群体行为描述' },
    ],
  },
  {
    code: 'relation',
    patterns: [
      { re: /仅仅是因为.{0,24}吗|只是因为.{0,24}吗|难道.{0,24}吗/, weight: 6, label: '含「仅仅是因为……吗」式单一归因反问' },
      { re: /是否|该不该|能不能|应不应该|要不要|是.{0,12}还是|比.{0,10}更重要|更重要|固然.{0,40}但|然而.{0,40}是否/, weight: 5, label: '含两难、取舍或比较句式' },
      { re: /有人认为.{0,50}有人|有人觉得.{0,50}有人|有人.{0,24}有人|有人.{0,12}担忧/, weight: 5, label: '含观点对立' },
      { re: /与.{1,10}的(关系|之间)|和.{1,10}之间|.{1,8}与.{1,8}(的|之间|孰|谁)/, weight: 4, label: '含关系辨析句式' },
      { re: /谈谈你的(认识|思考|理解)|你有怎样的思考|你怎么看|如何看待|请写一篇文章/, weight: 2, label: '含「谈谈认识/思考」类指令' },
      { re: /吗[？?]|[？?]\s*$/, weight: 2, label: '含疑问句' },
    ],
  },
];

const TYPE_PRIORITY = ['relation', 'quotation', 'phenomenon', 'growth'];

/** 题型判定：按加权特征打分，取最高分；同分时按 TYPE_PRIORITY 优先；无信号时归为思辨关系类。 */
export function detectQuestionType(topic) {
  const text = String(topic || '');
  const scores = {};
  const signals = {};

  for (const rule of DETECTION_RULES) {
    let score = 0;
    const hits = [];
    for (const pattern of rule.patterns) {
      if (pattern.re.test(text)) {
        score += pattern.weight;
        hits.push(pattern.label);
      }
    }
    scores[rule.code] = score;
    signals[rule.code] = hits;
  }

  const ranked = [...TYPE_PRIORITY].sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0];
  const code = scores[best] > 0 ? best : 'relation';
  const hits = signals[code] || [];

  const reason =
    hits.length > 0
      ? `题面命中：${hits.join('、')}（加权得分 ${scores[code]}），因此判定为${QUESTION_TYPES[code].name}。`
      : '未检测到明显的题型特征词，按上海卷最常见的思辨关系类处理；写作时仍需自行补足概念辨析。';

  return {
    code,
    name: QUESTION_TYPES[code].name,
    summary: QUESTION_TYPES[code].summary,
    reason,
    scores,
    signals: hits,
  };
}

// 常见论述概念词表（按长度降序使用，优先取更完整的表述）。
const CONCEPT_LEXICON = Array.from(
  new Set([
    '好奇心', '认可度', '陌生世界', '标准答案', '人工智能', '社交媒体', '可能性', '不确定性',
    '已知', '未知', '发问', '结论', '探索', '陌生', '熟悉', '成长', '童年', '青春', '记忆',
    '经历', '挫折', '陪伴', '价值', '选择', '自由', '规则', '传统', '创新', '责任', '自我',
    '他人', '社会', '真理', '边界', '答案', '问题', '认知', '经验', '习惯', '偏见', '共识',
    '判断', '标准', '意义', '科技', '网络', '阅读', '时间', '坚持', '改变', '距离', '独立',
    '从众', '个性', '包容', '理解', '沟通', '勇气', '质疑', '怀疑', '确定', '效率', '过程',
    '结果', '目的', '手段', '个体', '群体', '时代', '文化', '教育', '理想', '现实', '得失',
    '取舍', '快慢', '有用', '无用', '苦难', '孤独', '归属', '远方', '家园', '变化', '恒常',
    '有限', '无限', '认可', '评价', '高下', '评判', '尺度', '追问', '好奇', '答案',
    '起点', '终点', '热爱', '坚持', '边界', '秩序', '创造', '传承', '初心', '社交平台',
    '展示', '生活', '目光', '口碑', '榜单', '热搜', '评分', '算法推荐', '不确定性',
  ])
).sort((a, b) => b.length - a.length);

const STOP_PREFIX = /^(小时候|长大后|如今|当下|生活中|现实里|有人说|一个人|人们|我们|常常|往往|越来越|仅仅是因为|只是因为|请写|谈谈|对此|关于|对于|所谓)/;

const INSTRUCTION_RE = /这句话|怎样的思考|你的认识|你的理解|请写|谈谈|引发|自拟|不少于|要求|你怎么看|如何看待|文体|写一篇文章|对此/;

function fallbackPhrases(topic) {
  // 先切掉「请写一篇文章」之后的写作指令，保留题面陈述部分。
  const core = String(topic)
    .split(/请写一篇文章|自拟题目|不少于\s*\d+\s*字|要求[（(]/)[0]
    .replace(/^(谈谈|请写|关于|对于|对此)\s*/, '')
    .trim();

  const clauses = core
    .split(/[，。；、,.;:：!！?？\s「」『』“”"'‘’（）()]+/)
    .map((s) => s.replace(STOP_PREFIX, '').replace(/[。，、；！？.]+$/g, '').trim())
    .filter((s) => s && !INSTRUCTION_RE.test(s));

  const phrases = clauses.filter((s) => s.length >= 2 && s.length <= 14);
  // 过长的分句按常见谓语切开，取出可作为论述对象的短语。
  for (const clause of clauses) {
    if (clause.length <= 14) continue;
    for (const piece of clause.split(/习惯|展示|使用|借助|判别|区分|认为|觉得|成为|在于|选择|因为|通过|把|被|而是|就是|常用|乐意|更愿意/)) {
      const p = piece.trim();
      if (p.length >= 2 && p.length <= 14 && !INSTRUCTION_RE.test(p)) phrases.push(p);
    }
  }
  return [...new Set(phrases)].slice(0, 4);
}

/** 识别题眼：引号内容 > 「仅仅是因为 X 吗」中的 X > 「谈谈你对 X 的认识」中的 X。 */
function detectFocusTerm(text) {
  const patterns = [
    /[「『“"'‘]([^」』”"'’]{2,20})[」』”"'’]/,
    /(?:仅仅|只是)是因为(.{2,12}?)(?:吗|？|\?)/,
    /(?:谈谈你对|对)(.{2,12}?)的(?:认识|思考|理解|看法)/,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match && match[1]) {
      const term = match[1].replace(/[「」『』“”"'‘’]/g, '').replace(/[。，、；！？.!?]+$/g, '').trim();
      if (term) return term;
    }
  }
  return null;
}

/** 抽取核心概念：题眼 > 概念词表命中 > 题面主干短语，始终保证不少于 2 个。 */
export function extractConcepts(topic, questionType) {
  const text = String(topic || '');
  const concepts = [];
  const seen = new Set();

  const add = (term, role) => {
    const key = term.trim();
    if (!key || seen.has(key)) return false;
    if ([...seen].some((s) => s.includes(key))) return false;
    seen.add(key);
    const explanation =
      role === '题眼概念'
        ? `「${key}」是本题的题眼：题面围绕它设问或要求谈认识，全文应首先界定它，并始终回应与它相关的追问，不能移向别的话题。`
        : role === '引述核心词'
          ? `「${key}」是题面直接引述或加引号强调的表述，全文的概念界定必须围绕它展开，先说明它「是什么」再说明它「不是什么」。`
          : role === '题面关键词'
            ? `「${key}」是题目中的关键概念，需要界定内涵与外延，并解释它为何成为本题的讨论对象，避免与相近概念混用。`
            : `「${key}」是从题面主干中抽取的论述对象，写作时应先明确所指，并在各段中保持同一含义，防止概念滑动。`;
    concepts.push({ term: key, role, explanation });
    return true;
  };

  const focus = detectFocusTerm(text);
  if (focus) add(focus, '题眼概念');

  for (const match of text.matchAll(/[「『“"'‘]([^」』”"'’]{2,20})[」』”"'’]/g)) {
    add(match[1].replace(/[。，、；！？.!?]+$/g, '').trim(), '引述核心词');
  }

  for (const word of CONCEPT_LEXICON) {
    if (concepts.length >= 5) break;
    if (text.includes(word)) add(word, '题面关键词');
  }

  if (concepts.length < 3) {
    for (const phrase of fallbackPhrases(text)) {
      if (concepts.length >= 4) break;
      add(phrase, '题面主干');
    }
  }

  if (concepts.length < 2) {
    const head =
      (text.split(/[，。；、！？?？]/)[0] || '')
        .replace(/[「」『』“”"'‘’（）()]/g, '')
        .replace(/^(有人说|谈谈|请写|关于|对于|所谓)/, '')
        .replace(/^[:：\s]+/, '')
        .trim()
        .slice(0, 16) || '题面主旨';
    add(head, '题面主干');
  }
  if (concepts.length < 2) {
    add('题面隐含的价值判断', '题面主干');
  }

  return concepts;
}

/** 抽取限制条件：题面显性要求 + 题型隐性要求 + 通用写作规范。 */
export function extractConstraints(topic, questionType, concepts) {
  const text = String(topic || '');
  const list = [];

  const wordCount = text.match(/不少于\s*(\d+)\s*字/);
  if (wordCount) list.push(`字数：不少于 ${wordCount[1]} 字，成篇需完整，不能以提纲或片段代替。`);
  if (/自拟题目|自拟标题|题目自拟/.test(text)) {
    list.push('标题：须自拟，不能直接把题目原句或「论××」当成标题就了事。');
  }
  if (/请写一篇文章|写一篇|文体不限|写一篇文章/.test(text)) {
    list.push('文体：完整文章，通常按议论性文章组织，须有明确中心论点与可辨识的段落层次。');
  }
  if (/谈谈你的(认识|思考|理解)|你有怎样的思考|你怎么看|如何看待|请谈谈/.test(text)) {
    list.push('任务：须表达「我」的认识与判断，不能只复述材料、堆砌事例或给出标准答案式的结论。');
  }
  const forbid = text.match(/(?:不得|不能|不可|不要)([^，。；,.;]{2,20})/g);
  if (forbid) list.push(`题面明确限制：${forbid.slice(0, 2).join('；')}。`);

  const typeConstraint = {
    relation: '题型限制：含反问、取舍或观点对立时必须否定单一归因、展开多层辨析，不能只回答「是 / 否」或只站其中一方。',
    phenomenon: '题型限制：须先解释这一现象为何普遍（合理性），再辨析其代价与失灵之处，不能一上来就作道德批判。',
    quotation: '题型限制：须先界定引语的含义与适用范围，再谈自己的思考；不能把引语当作无需论证的真理直接套用。',
    growth: '题型限制：须从具体经历出发提炼出可迁移的认识，避免写成纯叙事或空洞抒情。',
  }[questionType?.code];
  if (typeConstraint) list.push(typeConstraint);

  const first = concepts[0]?.term || '题目核心概念';
  list.push(`概念约束：全文须紧扣「${first}」等题面概念，不得偷换成相近但不同的话题。`);
  list.push('材料约束：题目给出的现象、问句或对立观点必须在文中得到正面回应，不能另起炉灶写一篇预制作文。');
  list.push('规范约束：不得套作、不得抄袭；论据需与论点对应，例证之后要有分析而非排队罗列。');

  return list;
}

function angle(title, level, fit, description) {
  return { title, level, fit, description };
}

/** 生成 5 个分层立意，按题型套用不同论证路径，并把题面概念嵌入描述。 */
export function buildAngles(topic, questionType, concepts) {
  const a = concepts[0]?.term || '题目核心概念';
  const b = concepts[1]?.term || '与之相对的一面';
  const c = concepts[2]?.term || '更广的处境';
  const code = questionType?.code || 'relation';

  const byType = {
    relation: [
      angle(
        `不止于「${a}」：拆开单一归因`,
        '基础稳妥',
        '高度切题·建议作主论点',
        `先承认「${a}」确实是题面给出的最直觉解释，再指出它只能说明起步、难以说明全部；围绕「${b}」补出被省略的动因或条件，形成「启动—维持—赋义」的层次。此角度正面回应题眼「仅仅」，最不易偏题。`
      ),
      angle(
        `「${a}」与「${b}」：不是对立，而是有张力的互补`,
        '进阶提升',
        '高度切题',
        `把看似二选一的两端还原为同一过程的不同环节：没有「${b}」，「${a}」容易落空；没有「${a}」，「${b}」会失去起点。论证重心放在二者如何互相限定、互相转化，比单方面褒贬更有思辨含量。`
      ),
      angle(
        `追问题设本身：「${a}」这个说法是否已被简化`,
        '深度思辨',
        '较切题·需回扣材料',
        `不再急于补充原因，而是检讨题目赖以成立的预设：为什么我们习惯把复杂的事归因于一个轻盈的词？由此讨论「${c}」所代表的处境如何被这一简化遮蔽。写此角度务必逐处回扣原题用词，避免脱离材料空谈方法。`
      ),
      angle(
        `两种评价、两把尺子：分歧来自度量标准不同`,
        '深度思辨',
        '较切题',
        `若题面出现「有人认为……有人觉得……」一类对立，可不急于裁决谁对，而是分析各自背后的价值尺度，再指出个人与社会应如何同时为两把尺子留出位置。适合展示辨析的公平性。`
      ),
      angle(
        `从认识落到行动：在具体处境中如何取舍`,
        '实践落点',
        '切题·宜作收束段',
        `把结论收束到「那么该怎么做」：在必须给出判断的现实里，如何为「${a}」保留位置、又不被「${b}」绑住。单独成篇容易论证偏薄，建议用作主体末段或结尾的落点。`
      ),
    ],
    phenomenon: [
      angle(
        `先说清它为什么「常用」：现象背后的合理性`,
        '基础稳妥',
        '高度切题·建议作开头主体',
        `题面说的是「生活中常用」而非「误用」，因此先解释这一现象何以普遍：信息过载、判断成本高、协作需要，都让人倾向于借助「${a}」。把这一层写足，后文的批评才不显得清高。`
      ),
      angle(
        `「${a}」量得出什么、量不出什么`,
        '进阶提升',
        '高度切题·建议作主论点',
        `区分「被认可 / 被看见的程度」与「本身是否值得」，围绕「${b}」说明二者相关却不同一；再给出失灵的具体机制（滞后、放大、场域差异）。这是本题最稳健也最有纵深的主论点。`
      ),
      angle(
        `谁在计数：追问「${a}」背后的主体与规则`,
        '深度思辨',
        '较切题·易出彩',
        `把看似客观的结果还原为具体的主体与机制：不同群体、平台、时代会给出相反的高下。先问「尺子由谁制成」，再读刻度，讨论便从数量推进到规则，需要紧扣「${c}」展开。`
      ),
      angle(
        `当尺子反过来塑造被量之物`,
        '深度思辨',
        '较切题·需回扣评价行为',
        `指出更隐蔽的一层：一旦社会普遍用「${a}」区分高下，被评价者会开始迎合这把尺子，于是测量结果成了生产标准。须回扣题目「判别事物、区分高下」的评价行为，避免滑成泛泛的潮流批判。`
      ),
      angle(
        `用而不依赖：重建一把自己的尺子`,
        '实践落点',
        '切题·宜作收束段',
        `不主张弃用「${a}」，而是补上亲验、专业判断与长期标准，让外部结果只作线索不作结论。适合放在辩证段之后收束全文，单独成篇易空泛。`
      ),
    ],
    quotation: [
      angle(
        `先界定：这句话究竟在说什么`,
        '基础稳妥',
        '高度切题·必须有的第一段',
        `把引语中的「${a}」拆开解释，说明其字面义、指向的对象与隐含前提；同时划定「它不是在说什么」，防止全篇概念含混。此段是后续所有思考的地基。`
      ),
      angle(
        `同意并推进：它在什么条件下成立`,
        '进阶提升',
        '高度切题',
        `不重复引语，而是为它补出成立的条件与具体的现实对应，围绕「${b}」说明这一判断为何在今天仍有解释力。论证要有事例，且每个事例后补一句「这说明……」。`
      ),
      angle(
        `限定与补充：它在哪里会失灵`,
        '深度思辨',
        '较切题·体现分寸',
        `找出引语被过度推广时出现的反例：当「${c}」介入，原判断需要被修正或加上边界。敢于限定一句名言，比一味印证更能体现「我的认识」。`
      ),
      angle(
        `反向追问：引语背后未被言明的预设`,
        '深度思辨',
        '较切题·需回扣原句',
        `检讨这句话默认了什么（关于人、关于价值、关于时代），并指出该预设并非不证自明。写此角度要反复回扣原句用词，避免借题发挥成另一篇文章。`
      ),
      angle(
        `从「别人说」到「我怎么看」`,
        '实践落点',
        '切题·宜作结尾',
        `把引语当作对话者而非结论，收束到自己据此形成的判断与可持守的姿态。呼应题目「谈谈你的认识」，避免以又一句名言收尾。`
      ),
    ],
    growth: [
      angle(
        `从具体经历里提炼那个转折点`,
        '基础稳妥',
        '高度切题·必须有的叙事基底',
        `围绕「${a}」选定一件具体的事，写清转折前后的差别，不铺陈全过程；叙述服务于认识，避免把文章写成流水账或纯抒情。`
      ),
      angle(
        `经历如何改变了「我」对「${b}」的理解`,
        '进阶提升',
        '高度切题·建议作主论点',
        `把体验抬到认识层面：原先怎么想、后来为什么改、改变带来什么代价与收获。以认知变化为主线，比单纯写「我长大了」更有层次。`
      ),
      angle(
        `一个人的小事，如何连到「${c}」这一普遍处境`,
        '深度思辨',
        '较切题',
        `把个体经验与更广的处境接通，说明这件小事并非孤例，而是许多人共同面对的命题。注意由具体到一般要有过渡，不能生硬拔高。`
      ),
      angle(
        `成长得到的，是否也意味着某种失去`,
        '深度思辨',
        '较切题·体现分寸',
        `反思「变化」的另一面：获得确定性的同时是否交出了别的可能。给成长加一层自省，可避免结论过于顺滑。`
      ),
      angle(
        `回到此刻：我把这段经历放在哪里`,
        '实践落点',
        '切题·宜作结尾',
        `结尾不喊口号，而是给出一个具体、克制的当下姿态，说明这段经历如今如何影响「我」的选择。`
      ),
    ],
  };

  return byType[code] || byType.relation;
}

const OUTLINE_RATIO = ['约 10%｜80—100 字', '约 18%｜150—180 字', '约 24%｜190—240 字', '约 24%｜190—240 字', '约 12%｜100—120 字', '约 12%｜100—120 字'];

function outlineOf(parts, concepts) {
  const a = concepts[0]?.term || '核心概念';
  const b = concepts[1]?.term || '相对的一面';
  return parts.map((p, i) => ({
    section: p.section,
    function: p.function,
    ratio: OUTLINE_RATIO[i],
    guidance: p.guidance(a, b),
  }));
}

/** 生成 6 段式提纲：每段标明段落功能与字数配比。 */
export function buildOutline(topic, questionType, concepts) {
  const code = questionType?.code || 'relation';
  const byType = {
    relation: [
      { section: '开头·接住问句', function: '直接回应题眼的追问，亮出中心判断并限定讨论范围。', guidance: (a, b) => `不要另起炉灶解释什么是「${a}」。用一句凝练的判断接住反问，点明「不止于 ${a}，也不等于否定 ${a}」。` },
      { section: '主体一·把直觉答案说到位', function: '先立后破，把题目给出的最自然解释写充分。', guidance: (a) => `充分说明「${a}」为何成立、可解释哪一层现象，配一个具体例证；写足这一段，后文的补充才不是简单否定。` },
      { section: '主体二·指出它的边界', function: '说明直觉答案解释不了的部分，自然引出其他层次。', guidance: (a, b) => `扣住「${a}」解释不了的地方，转向「${b}」；按「启动 / 维持 / 赋义」分层，而非平铺清单。` },
      { section: '主体三·展开核心命题（全文重心）', function: '给出自己最看重的一层判断并深入论证。', guidance: (a, b) => `聚焦一个命题深挖，如「${a} 与 ${b} 互为条件」或「题设本身已被简化」；配 1—2 个例证，每例后补一句分析。` },
      { section: '辩证·回应反方', function: '主动处理可能的质疑，防止论点绝对化。', guidance: () => '承认相反情形确有道理，区分「合理的确定」与「过早的封闭」，把主张收得更精确。' },
      { section: '结尾·回到「我」', function: '回扣「谈谈你的认识」，给出可持守的立场。', guidance: (a) => `收在「带着 ${a} 继续追问」一类判断，呼应开头；避免「让我们勇于探索」式空喊。` },
    ],
    phenomenon: [
      { section: '开头·描述现象并设问', function: '从题面现象起笔，承认其普遍性后提出疑问。', guidance: (a) => `用一两个日常场景带入「${a}」，别一开篇就下判词；以「它确实好用，但好用不等于可靠」立起张力。` },
      { section: '主体一·解释它为什么流行', function: '把现象背后的合理性说透，建立论证公平性。', guidance: () => '从判断成本、专业门槛、协作需要说明聚合评价为何被依赖；此处越扎实，批评越不清高。' },
      { section: '主体二·指出错位与失灵机制', function: '论证「被认可」不等于「值得认可」，给出机制。', guidance: (a, b) => `聚焦两种机制：滞后与放大，围绕「${b}」展开；每例后补一句「这说明……」，避免例子排队。` },
      { section: '主体三·追问主体与规则（全文重心）', function: '还原「谁在评价」，把讨论从数量推进到规则。', guidance: (a) => `用「先问尺子由谁制成，再读 ${a} 的刻度」作枢纽句；对照不同场域给出的相反高下。` },
      { section: '辩证·不作逆反式结论', function: '处理「那就完全不看吗」的质疑。', guidance: () => '明确低认可度也不自动等于高价值；主张校准而非推翻，区分「参考」与「交出判断权」。' },
      { section: '结尾·建立自己的尺度', function: '回扣「区分高下」，给出判断姿态。', guidance: () => '收在「用得起众人的尺，也保得住自己的尺」，避免平面口号。' },
    ],
    quotation: [
      { section: '开头·释义而非复述', function: '用自己的话界定引语含义，亮出初步态度。', guidance: (a) => `不要照抄原句作开头。先说明「${a}」在此处指什么、不指什么，再点出自己要推进的方向。` },
      { section: '主体一·界定概念与前提', function: '拆开引语的关键概念，说明其隐含预设。', guidance: () => '给出稳定的定义，划清内涵与外延；为后文的限定与追问留出接口。' },
      { section: '主体二·说明它何时成立', function: '为引语补出现实条件与具体例证，把赞同写扎实。', guidance: (a, b) => `联系「${b}」给出 1—2 个具体人事，每例后说明它证明了引语的哪一层，而非笼统印证。` },
      { section: '主体三·限定、补充或追问（全文重心）', function: '给出自己的核心思考：失灵处或未被言明的预设。', guidance: (a) => `二选一深入：或指出「${a}」在何种条件下需被修正，或追问引语默认了什么；不要两段都浅尝。` },
      { section: '辩证·防止走向反面', function: '承认引语的价值，避免为求深刻而全盘推翻。', guidance: () => '说明限定不是否定，分寸本身即思辨；可补一句「若没有这句提醒，我们容易忽略什么」。' },
      { section: '结尾·从「别人说」到「我怎么看」', function: '把引语当对话者，收束到自己的判断。', guidance: () => '呼应开头释义，给出可持守的姿态；不要用又一句名言收尾。' },
    ],
    growth: [
      { section: '开头·切入具体场景', function: '以一个有画面感的瞬间起笔，避免泛泛抒情。', guidance: (a) => `直接写与「${a}」相关的那个瞬间，不铺陈背景；一句感受点出它为何值得写。` },
      { section: '主体一·写清转折', function: '呈现前后差别，让经历成为认识的载体。', guidance: () => '只写关键片段，标明「原先怎样 / 后来怎样」；叙述始终服务于后面的提炼。' },
      { section: '主体二·提炼认识（全文重心）', function: '把体验抬到认知层面，说明「我」的理解如何改变。', guidance: (a, b) => `围绕「${a}」到「${b}」的变化展开：原先怎么想、为什么改、代价是什么，避免停留在「我长大了」。` },
      { section: '主体三·由个别通向一般', function: '把个人经验与更广的处境接通。', guidance: () => '说明这件小事并非孤例，但要有过渡，不能生硬拔高到时代或人类。' },
      { section: '辩证·成长中的得与失', function: '给顺滑的结论加一层自省。', guidance: () => '反思获得确定性时是否交出了别的可能，让判断有分寸。' },
      { section: '结尾·回到此刻', function: '说明这段经历如今如何影响「我」。', guidance: () => '给出一个具体、克制的当下姿态，不用口号收束。' },
    ],
  };

  return outlineOf(byType[code] || byType.relation, concepts);
}

/** 素材方向：与题型相关的通用方向 + 围绕题面概念的定向建议。 */
export function buildMaterials(topic, questionType, concepts) {
  const a = concepts[0]?.term || '核心概念';
  const b = concepts[1]?.term || '相对的一面';
  const common = {
    relation: [
      { direction: '科学史与思想史：结论被重新追问的时刻', examples: ['哥白尼对托勒密体系的重新发问', '爱因斯坦对牛顿绝对时空的质疑', '波普尔「猜想与反驳」：知识靠不断推翻暂时性结论增长'] },
      { direction: '古典与教育：提问如何被保护或被磨平', examples: ['屈原《天问》连发百余问', '苏格拉底「我唯一知道的是我一无所知」', '课堂中「标准答案」与「还有别的可能吗」的张力'] },
    ],
    phenomenon: [
      { direction: '评价机制的现实样本', examples: ['同行评议与流量榜单对同一作品给出相反高下', '算法按互动量放大内容，认可的其实是「可被传播」', '长期口碑与短期热度的对照'] },
      { direction: '价值被延迟确认的案例', examples: ['梵高生前几乎不被认可，身后被反复重估', '孟德尔的豌豆实验沉睡数十年才被重新看见', '「从众效应」「马太效应」解释高者更高的放大机制'] },
    ],
    quotation: [
      { direction: '可与该引语互证或对照的思想资源', examples: ['同一位作者在其他著作中的相关表述', '另一传统中对同一命题的不同判断', '一句立场相近但适用范围更窄的表述'] },
      { direction: '能检验引语边界的现实反例', examples: ['引语成立的具体情境', '引语被过度推广后出现的例外', '因时代条件变化而需要修正的情形'] },
    ],
    growth: [
      { direction: '可迁移的同类体验', examples: ['一次计划落空后被迫改变路径的经历', '与一位陌生人的短暂交谈改变了某个成见', '长期坚持某事后对「结果」的重新理解'] },
      { direction: '文学与影像中的成长母题', examples: ['散文中对童年某个瞬间的回望', '人物在离开熟悉环境后重新认识自己', '日记、书信等第一人称材料中的自我对话'] },
    ],
  }[questionType?.code] || [];

  return [
    ...common,
    {
      direction: `围绕「${a}」的定向素材`,
      examples: [
        `找一个能具体说明「${a}」为何成为问题的人物或事件，写清其处境而非只写结果`,
        `找一个「${a}」看似成立、实则失效的反例，用于辩证段`,
        `从自身阅读或生活经验中取一个与「${a}」相关的小切口，比堆砌名人更可信`,
      ],
    },
    {
      direction: `连接「${a}」与「${b}」的桥梁素材`,
      examples: [
        `寻找同时包含两端的一个事例，用来论证二者并非对立`,
        '准备一句能概括二者关系的概念性表述，作为主体三的枢纽句',
        '预留一个反面情形，供辩证段承认其合理性',
      ],
    },
  ];
}

/** 写作建议与风险提示。 */
export function buildAdvice(topic, questionType, concepts) {
  const a = concepts[0]?.term || '核心概念';
  const byType = {
    relation: {
      tips: [
        '开头第一句就回应题眼的追问（「仅仅 / 是否 / 谁对」），不要先下定义再绕回题目。',
        '按「先立—再破—后合」推进：把直觉答案写充分，指出边界，再给出更高一层的判断。',
        `全文反复回扣「${a}」等原题用词，深度思辨的段落尤其要防止借题发挥。`,
        '例证之后必须有一句分析，说明它证明了哪一层，不能让例子自己说话。',
      ],
      risks: [
        '只回答「是 / 不是」，或把题目改写成「论好奇心的重要性」，属于最典型的偏题。',
        '罗列五六条原因却每条一句，看似全面实则没有论证层次。',
        '为求深刻而全盘否定题面给出的那一端，分寸失当，反而显得片面。',
        '结尾喊口号，没有回扣「我有怎样的思考」。',
      ],
    },
    phenomenon: {
      tips: [
        '先解释现象为何普遍，再作评价；把「常用」写成合理选择而非愚蠢从众。',
        '给出失灵的具体机制（滞后、放大、场域差异），比反复强调「不要从众」有力。',
        `给「${a}」一个稳定的定义，后文所有论述都回到这个定义，避免概念滑动。`,
        '辩证段明确「低认可度也不自动等于高价值」，防止用逆反代替思辨。',
      ],
      risks: [
        '开篇即道德批判，把题目中的「常用」直接判为错误，论证失去公平性。',
        '只谈「做自己」，始终没有回应「判别事物、区分高下」这一评价行为。',
        '把概念窄化成流量或热度，素材全部集中于网络现象，视野偏窄。',
        '反向套路：「凡不被认可的都是杰作」，用翻转代替分析。',
      ],
    },
    quotation: {
      tips: [
        '先释义再表态：用自己的话说明引语在此处指什么，并划清「它不是在说什么」。',
        '不要一味印证，务必安排一段「限定 / 补充 / 追问」以体现「我的认识」。',
        '事例要贴着引语的具体判断，每例后补一句「这说明引语的哪一层」。',
        '把引语当对话者而非结论，结尾回到自己的判断。',
      ],
      risks: [
        '把名言当作无需论证的真理，通篇用更多名言去印证它。',
        '完全不界定关键概念，导致「${a}」在文中含义来回变化。',
        '为求深刻而全盘推翻引语，却没有说明成立条件。',
        '借题发挥成另一篇文章，正文几乎不再回扣原句。',
      ],
    },
    growth: {
      tips: [
        '从一个具体瞬间切入，不铺陈全过程；细节要能承载后面的认识。',
        '把体验抬到认知层面，写清「原先怎么想、后来为什么改」。',
        '由个别通向一般时要有过渡，避免生硬拔高到时代或人类。',
        '结尾给一个具体、克制的当下姿态，不用口号收束。',
      ],
      risks: [
        '写成纯叙事或流水账，全文没有提炼出可迁移的认识。',
        '通篇抒情，用「我长大了」「感触很深」代替分析。',
        '为求深刻而否定经历本身的价值，结论与叙述脱节。',
        '细节与中心无关，画面虽多却没有推进。',
      ],
    },
  };

  const picked = byType[questionType?.code] || byType.relation;
  return {
    writingTips: [
      ...picked.tips,
      `标题建议避开「论${a}」这类万能格式，尽量把你的核心判断写进标题。`,
      '成篇前先用一句话写出中心论点，再检查每一段是否都在为它服务。',
    ],
    risks: [
      ...picked.risks,
      `注意：输入题目长度上限为 ${MAX_TOPIC_LENGTH} 字；本剖析仅为思路指导，不生成范文或评分。`,
    ],
  };
}

/**
 * 本地剖析主函数（纯函数）：对任意题目返回固定结构的 JSON。
 * 不读取环境变量、不发起网络请求、不依赖时间，便于单元测试。
 */
export function analyzeLocal(topic) {
  const text = String(topic ?? '').trim();
  const questionType = detectQuestionType(text);
  const coreConcepts = extractConcepts(text, questionType);
  const constraints = extractConstraints(text, questionType, coreConcepts);
  const angles = buildAngles(text, questionType, coreConcepts);
  const outline = buildOutline(text, questionType, coreConcepts);
  const materials = buildMaterials(text, questionType, coreConcepts);
  const { writingTips, risks } = buildAdvice(text, questionType, coreConcepts);

  return {
    topic: text,
    questionType,
    coreConcepts,
    constraints,
    angles,
    outline,
    materials,
    writingTips,
    risks,
    engine: 'local',
  };
}
