

const axios = require('axios')
const parser = require('cheerio')

const fileManager = require('fs')
const prompt = require("prompt-sync")()

async function getUrlResource(url, resourceName) {
  try {
    const res = await axios.get(url)
    const $ = parser.load(res.data)
    
    if(resourceName === 'title') {
      return $('title').text()
    } 

    return $('body').html()

  } catch(err) {
    console.log('Algum erro', err)
  }
}

async function pushResources(uniqueUrls) {
  const resources = []
  for(const url of uniqueUrls) {
    resources.push(
      {
        subject: await getUrlResource(url, 'title'),
        url: url,
        body: await getUrlResource(url, '')
      }
    )
  }
  return resources
}

function pushReferencies(resourcesReport, parenthoodReport) {
  const statistics = []
  for(const i of resourcesReport) {
    const urlCalls = parenthoodReport.filter(i2 => i2.childUrl === i.url)
    
    statistics.push(
      {
        urlSubject: i.subject,
        calls: urlCalls,
        callsLength: urlCalls.length,
      }
    )
    // console.log(i.subject, eachUrlParenthood.filter(i2 => i2.childUrl === i.url).length)
  }
  return statistics
}

async function crawlUrls(url) {
  const visitedUrls = new Set();
  const queueUrls = [url]
  const uniqueUrls = new Set([url])
  const repeated = []
  
  while (queueUrls.length > 0) {
    const currentUrl = queueUrls.shift()

    if (visitedUrls.has(currentUrl)) {
      continue
    }
    
    try {
      visitedUrls.add(currentUrl)

      const res = await axios.get(currentUrl)
      const $ = parser.load(res.data)
      const urlsWithin = []
      
      $('a').each((pos, tag) => {
        const urlHref = $(tag).attr('href')
        
        repeated.push(
          {
            fatherUrl: currentUrl,
            childUrl: urlHref,
            alike: currentUrl === urlHref,
            title: $('title').text()
          }
        )
        
        if (urlHref) {
          const cleanLink = new URL(urlHref, currentUrl).href
          urlsWithin.push(cleanLink)
        }
      })
  
      for (const link of urlsWithin) {
        if (!uniqueUrls.has(link)) {
          uniqueUrls.add(link)
          queueUrls.push(link)
        }
      }

    } catch(err) {
      console.log('Algum erro', err)
    }
  }

  return {
    unique: Array.from(uniqueUrls),
    history: Array.from(repeated)
  }
}

function doesFileExist(route) {
  try {
    fileManager.accessSync(route, fileManager.constants.F_OK);
    return true // it exists
  } catch (err) {
    return false // it does not
  }
}

function readTxt(route) {
  return fileManager.readFileSync(route, 'utf-8')  
}

function appendDown(fileName, content) {
  // fileManager.appendFileSync(fileName, JSON.stringify(content), 'utf-8', err => {console.log(err)})
  fileManager.appendFileSync(fileName, content, 'utf-8', err => {console.log(err)})
}

function startFile(fileName) {
  fileManager.writeFileSync(fileName, '', 'utf-8')
}

class Searcher {
  find(fileString, keyword, scoreGiven) {
    const container = []

    for(let i = 0; i < fileString.length; i++) {
      const isIndiceBody = fileString[i][0] === '<'
      
      if(isIndiceBody) {
        const getWordEncounters = fileString[i].split(keyword).length - 1
  
        // Make data structure about it
        container.push(
          {
            'Local': fileString[i - 1].trim(),
            'Qtd.': getWordEncounters,
            'Pontos': getWordEncounters * scoreGiven
          }
        )
      }
    }

    container.sort((a, b) => b['Qtd.'] - a['Qtd.'])
    
    return container
  }
}

class Rank {
  constructor() {
    this.authScore = 10
    this.wordFound = 5
    this.selfReferencePenalty = -15

    this.rank = []
    this.singular = [0, 1]
  }

  calculateAuthority(currentUrl, parenthood) {
    let calculus = currentUrl.callsLength * this.authScore
    
    for(const url of parenthood) {
      // if self reference was found 
      if(url.title === currentUrl.urlSubject & url.alike) {
        // remove the score given to the url previously, because there was self reference
        calculus -= this.authScore
        // then give negative score as punishment for self reference
        calculus += this.selfReferencePenalty
      }
    }

    return calculus
  }

  addAuthorityPoints(target, parenthood) {
    for(let i = 0; i < target.length; i++) {
      // data for procedures of calculus
      this.rank.push(
        {
          term: target[i].urlSubject,
          calls: target[i].callsLength,
          callScore: this.calculateAuthority(target[i], parenthood), // penalty if self references
          callWhere: target[i].calls.map(i => i.title)
        }
      )
    }
    
    return this.rank
  }

  addQueryPoints(queryArray) {
    for(const i of this.rank) {
      const timesFound = queryArray.filter(j => j['Local'].trim() === i.term.trim())[0]['Pontos']
      i.callScore += timesFound
      i.searchedWordEncounters = queryArray.filter(j => j['Local'] === i.term)[0]['Qtd.']
    }
  }

  addSelfReferenceArray(reference) {
    for(let i = 0; i < this.rank.length; i++) {
      this.rank[i].selfReferenceHistory = reference.filter(
        history => history.title === this.rank[i].term)
        .filter(history => history.alike).map(history => history.alike)
    }
  }

  reduceCallsFromSelfReferenced() {
    for(const url of this.rank) {
      if(url.selfReferenceHistory.length !== 0) {
        url.calls -= url.selfReferenceHistory.filter(i => i === true).length
      }
    }
  }
  
  initGroupSort() {
    this.rank.sort((a, b) => {
      // critérios = 4
      // [1] + links externos [2] maior busca [3] menor qtd. auto referência [4] maior pont. total
      const mostLinkCallsInFront = b.calls - a.calls
      const largerQueryResultInFront = b.searchedWordEncounters - a.searchedWordEncounters
      const noSelfReferenceInFront = (a.selfReferenceHistory || []).length - (b.selfReferenceHistory || []).length 
      const biggerScoreInFront = b.callScore - a.callScore
      
      if(a.calls !== b.calls) return mostLinkCallsInFront
      if(a.searchedWordEncounters !== b.searchedWordEncounters) return largerQueryResultInFront
      if((a.selfReferenceHistory || []).length - (b.selfReferenceHistory || []).length ) return noSelfReferenceInFront
      return biggerScoreInFront
    })
  }

  show(rank) {
    let pos = 1
    const positions = []

    for(const i of rank) {
      positions.push(`
        ======= [ ${i.callScore} pontos ] ${pos}º lugar: ${i.term} =======
        chamadas externas    || ${i.calls} páginas (${i.calls} x ${this.authScore})
        páginas              || ${i.callWhere}
        buscas da palavra    || ${i.searchedWordEncounters} ${this.singular.includes(i.searchedWordEncounters) ? 'registro' : 'registros'} (${i.searchedWordEncounters} x ${this.wordFound})
        se auto referenciou? || ${i.selfReferenceHistory.length} (${i.selfReferenceHistory.length * this.selfReferencePenalty} pts)
        pontos ref. + busca  || ${i.callScore} (+${this.authScore * i.calls} pts) (+${this.wordFound * i.searchedWordEncounters} pts)`)
        
      pos++
    }
    
    return positions
  }

}

class TerminalProgram {
  constructor() {
    this.engine = true
    this.keyTerms = 'matrix.ficção científica.realidade.universo.viagem'.split('.')
    this.banner = '========== AVISO ==========\n'
    this.pressEnter = '>>> APERTE ENTER p/ continuar <<<'
    this.typeDynamicUrl = 'Digite a url dinâmica'
    
    this.bye = `${this.banner} Programa encerrado. Até uma próxima!`
    this.outOfRange = `${this.banner}Opção escolhida está fora do intervalo: 0 ao 2!`
    this.urlChanged = `${this.banner}Url foi modificada`
    
    this.searcher = new Searcher()
    this.rank = new Rank()
    this.originUrl = 'https://lucasfarias072.github.io/mock-web-page-blade-runner/'
    this.neededData
    this.keyword
  }

  resetDynamicData() {
    this.keyword = ''
    this.neededData = {}
    this.rank.rank = []
  }

  startMenu() {
    return `
    ========== BUSCADOR ==========
    OPÇÕES
    0 - encerrar programa
    1 - fazer crawl com url padrão
    2 - fazer crawl com url padrão + termos chave
    3 - mudar url padrão
    4 - ver url padrão atual
    
    --o Informe a opção`
  }

  showKeyTerms() {
    return `
    ======= TERMOS CHAVE =======
    Escolha um dos termos chave
    ${this.keyTerms.map((term, pos) => `${pos + 1}. ${term}`).join(' || ')}
    
    --o Escolha uma das palavras fixas pelo número`
  }

  changeUrl() {
    console.log(this.typeDynamicUrl)
    const originUrl = prompt('>> ')
    this.originUrl = originUrl
    startFile('./bodies.txt')
    console.log(this.urlChanged)
    prompt(this.pressEnter)
  }

  treatInput(inputValue) {
    return this.keyTerms.includes(inputValue) ? true : false
  }

  obtainDataArbitrary() {
    console.log(this.showKeyTerms())
    const arbitraryKeyword = prompt('>> ')
    const termAssertion = this.treatInput(this.keyTerms[parseInt(arbitraryKeyword) - 1])
    if(termAssertion) {
      this.obtainData(arbitraryKeyword, false)
    } else {
      this.obtainDataArbitrary()
    }
  }

  async fetchData() {
    const crawlReport = await crawlUrls(this.originUrl)
    const uniqueUrls = [...crawlReport.unique]
    const parenthood = [...crawlReport.history]  // fatherUrl, childUrl, alike, title
    const uniqueUrlsResources = await pushResources(uniqueUrls) // subject, url, body
    
    /*
      urlSubject: Subject
      calls: Object[parenthood]
      callsLength: calls.length
    */
    const eachUrlStatistics = pushReferencies(uniqueUrlsResources, parenthood)

    return {
      'crawlReport': crawlReport,
      'uniqueUrls': uniqueUrls,
      'parenthood': parenthood,
      'uniqueUrlsResources': uniqueUrlsResources,
      'eachUrlStatistics': eachUrlStatistics
    }
  }

  obtainData(arbitraryKeyword, userFriendly=true) {
    startFile('./bodies.txt')
    
    const fileLength = fileManager.statSync('./bodies.txt').size

    // Populate body from all unique urls if empty
    if(!doesFileExist('./bodies.txt') || fileLength === 0) {
      for(const data of this.neededData.uniqueUrlsResources) {
        const newContent = `#${data.subject} #${data.body.split()[0].split('\n').join(' ').toLowerCase().trim()}`
        appendDown('./bodies.txt', newContent)
      }
    } 
    
    // Access body from all unique urls 
    const bodiesArray = readTxt('./bodies.txt').split('#')

    // ===== ALGORITHM: Find how many calls a keyword has =====
    if (userFriendly) {
      this.keyword = prompt('Por favor, informe a palavra-chave >> ')
      if (this.keyword === 'ficcao cientifica') {
        this.keyword = 'ficção científica'
      }
    }
    else {
      this.keyword = this.keyTerms[parseInt(arbitraryKeyword) - 1]
    }
    
    const wordSearchHistory = this.searcher.find(bodiesArray, this.keyword, this.rank.wordFound)
    
    console.log(`===== Ocorrências da palavra: ${userFriendly ? this.keyword.toUpperCase() : this.keyTerms[parseInt(arbitraryKeyword) - 1]} =====`)
    console.log(wordSearchHistory)
    prompt(this.pressEnter)

    this.rank.addAuthorityPoints(this.neededData.eachUrlStatistics, this.neededData.parenthood)
    
    // sum current authority with query
    this.rank.addQueryPoints(wordSearchHistory)

    // add self reference attribute as draw criteria
    this.rank.addSelfReferenceArray(this.neededData.parenthood)
    
    // decrement calls from url calling themselves
    this.rank.reduceCallsFromSelfReferenced()
    
    // sort by 4 criteria: times referenced, query results from word, self reference, call score
    this.rank.initGroupSort()

    // rank.show(authorityRank)
    const ultimateRank = this.rank.show(this.rank.rank)
    
    for(let pos = 0; pos < ultimateRank.length; pos++) {
      const termTextRegion = ultimateRank[pos].split(' =')[1]
      const queryData = wordSearchHistory.filter(query => termTextRegion.includes(query['Local']))
      console.log('\n')
      console.log(queryData)
      console.log(ultimateRank[pos])
      
      prompt(`\n>>> Aperte ENTER p/ ver o ${pos < ultimateRank.length - 1 ? pos + 2 : 'último'}º colocado...`)
      console.clear()
    }
  }

  async init() {
    while (this.engine) {
      this.resetDynamicData()
      this.neededData = await this.fetchData()

      console.log(this.startMenu())
      const starterUrl = prompt('>> ')
      
      switch (starterUrl) {
        case '0':
          console.log(this.bye)
          this.engine = false
          break
        case '1':
          this.obtainData('')
          prompt(this.pressEnter)
          break
        case '2':
          this.obtainDataArbitrary()
          prompt(this.pressEnter)
          break
        case '3':
          this.changeUrl()
          break
        case '4':
          console.log(`===== AVISO: url padrão atual =====\n${this.originUrl}\n`)
          prompt(this.pressEnter)
          break
        default:
          console.log(this.outOfRange)
          prompt(this.pressEnter)
      }
    }
  }
}

async function main() {
  const terminal = new TerminalProgram()
  terminal.init()
}

main()