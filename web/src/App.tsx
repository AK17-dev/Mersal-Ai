import { useEffect, useState, useCallback, useRef } from 'react'
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, Loader2, RefreshCw, Sparkles, AlertCircle, Trash2, Edit3, Award, ThumbsUp, Activity, ShieldAlert } from 'lucide-react'

// Define the Document type matching our D1 schema
interface DocumentItem {
  id: string
  session_id: string
  filename: string
  language: string | null
  page_count: number | null
  status: 'processing' | 'ready' | 'failed'
  character_count: number
  error_message: string | null
  created_at: number
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  chunks?: {
    id: string
    filename: string
    page_number: number
    text: string
  }[]
  created_at: number
}

interface EvalCase {
  id: string
  question: string
  expected_answer: string
  language: 'en' | 'ar'
  last_result: string | null
  last_score: number | null
}

interface EvalRun {
  id: string
  created_at: number
  total: number
  correct: number
  faithfulness_score: number
}

// Bilingual translation dictionary
const translations = {
  en: {
    title: "Mersal",
    subtitle: "Bilingual Document Q&A Platform",
    session: "Session",
    tabDocuments: "Documents",
    tabChat: "Chat Q&A",
    tabEvaluation: "Evaluation Dashboard",
    uploadTitle: "Upload Documents",
    uploadSubtitle: "Upload English or Arabic PDFs. We will extract the text and index them for Q&A.",
    dragDrop: "Drag & Drop PDF here",
    clickBrowse: "or click to browse from explorer",
    processing: "Processing...",
    uploading: "Uploading PDF file...",
    storingR2: "Storing in Cloudflare R2 bucket",
    extracting: "Extracting document text...",
    runningUnpdf: "Running unpdf parsing engines",
    technicalLimits: "Known Technical Limits (CPU & OCR)",
    limit1: "50ms CPU Limit: Cloudflare Worker free tier enforces a 50ms CPU execution cap. Processing extremely large PDF files using JavaScript-native libraries may exceed CPU limits in production.",
    limit2: "Scanned PDFs: Text extraction is digital character-based. Non-OCR scanning is not supported; image-only uploads will fail text validation gracefully.",
    documentsHeader: "Documents",
    clearAll: "Clear All",
    refresh: "Refresh",
    loadingLibrary: "Loading document library...",
    noDocs: "No documents uploaded yet",
    noDocsDesc: "Upload your first Arabic or English PDF using the panel on the left to begin indexing.",
    pages: "Pages",
    length: "Length",
    chars: "chars",
    ready: "Ready",
    failed: "Failed",
    extractingPages: "Extracting structural page text...",
    askAnything: "Ask anything about your documents",
    askAnythingDesc: "Upload PDFs in the Documents tab, then ask questions here. Mersal will answer using only your uploaded context.",
    thinking: "Thinking...",
    placeholder: "Ask a question in Arabic or English...",
    send: "Send",
    viewSources: "View Sources",
    hideSources: "Hide Sources",
    error: "Error",
    confirmClearAll: "Are you sure you want to delete all documents? This action cannot be undone.",
    confirmClearAllTitle: "Delete All Documents",
    
    // Evaluation Tab Keys
    runEvals: "Run Evaluations",
    runningEvals: "Running Evaluations...",
    noEvals: "No evaluations run yet",
    pastRuns: "Past Evaluation Runs",
    casesHeader: "Evaluation Cases",
    accuracy: "Overall Accuracy",
    avgFaithfulness: "Average Faithfulness",
    totalCases: "Total Cases",
    languageBreakdown: "Language Breakdown",
    caseQuestion: "Question",
    caseExpected: "Expected Answer",
    caseGenerated: "Generated Answer",
    caseStatus: "Status",
    caseFaithfulness: "Faithfulness",
    caseReason: "Judge Explanation",
    editCase: "Edit Evaluation Case",
    saveChanges: "Save Changes",
    cancel: "Cancel",
    warnNoDocs: "Warning: You must upload at least one document and wait for it to be Ready before running evaluations.",
    passed: "Passed",
    failedLabel: "Failed",
    errorJudge: "Judge Error",
    runDate: "Date",
    arCases: "Arabic",
    enCases: "English",
    correctLabel: "Correct",
    incorrectLabel: "Incorrect"
  },
  ar: {
    title: "مرسال",
    subtitle: "منصة الأسئلة والأجوبة للمستندات",
    session: "الجلسة",
    tabDocuments: "المستندات",
    tabChat: "الدردشة والأسئلة",
    tabEvaluation: "لوحة التقييم",
    uploadTitle: "تحميل المستندات",
    uploadSubtitle: "قم بتحميل ملفات PDF باللغة العربية أو الإنجليزية. سنقوم باستخراج النصوص وفهرستها للأسئلة والأجوبة.",
    dragDrop: "اسحب وأسقط ملف PDF هنا",
    clickBrowse: "أو انقر للتصفح من جهازك",
    processing: "جاري المعالجة...",
    uploading: "جاري رفع ملف PDF...",
    storingR2: "جاري الحفظ في مساحة تخزين Cloudflare R2",
    extracting: "جاري استخراج نص المستند...",
    runningUnpdf: "تشغيل محركات تحليل unpdf",
    technicalLimits: "الحدود الفنية المعروفة (المعالج والـ OCR)",
    limit1: "حد المعالج 50 مللي ثانية: تفرض الفئة المجانية لـ Cloudflare Worker حداً أقصى لمعالجة المعالج يبلغ 50 مللي ثانية. قد تتجاوز معالجة ملفات PDF الكبيرة جداً هذا الحد.",
    limit2: "ملفات PDF الممسوحة ضوئياً: يعتمد استخراج النص على الحروف الرقمية. المسح الضوئي بدون OCR غير مدعوم؛ ستفشل الملفات الصورية فقط في التحقق من النص بشكل طبيعي.",
    documentsHeader: "المستندات",
    clearAll: "مسح الكل",
    refresh: "تحديث",
    loadingLibrary: "جاري تحميل مكتبة المستندات...",
    noDocs: "لم يتم تحميل أي مستندات بعد",
    noDocsDesc: "قم بتحميل أول ملف PDF باللغة العربية أو الإنجليزية باستخدام اللوحة الجانبية لبدء الفهرسة.",
    pages: "الصفحات",
    length: "الحجم",
    chars: "حرف",
    ready: "جاهز",
    failed: "فشل",
    extractingPages: "استخراج هيكل نص الصفحات...",
    askAnything: "اسأل أي شيء عن مستنداتك",
    askAnythingDesc: "قم بتحميل ملفات PDF في تبويب المستندات، ثم اطرح الأسئلة هنا. سيجيب مرسال باستخدام محتوى ملفاتك فقط.",
    thinking: "جاري التفكير...",
    placeholder: "اطرح سؤالاً باللغة العربية أو الإنجليزية...",
    send: "إرسال",
    viewSources: "عرض المصادر",
    hideSources: "إخفاء المصادر",
    error: "خطأ",
    confirmClearAll: "هل أنت متأكد من رغبتك في حذف جميع المستندات؟ لا يمكن التراجع عن هذا الإجراء.",
    confirmClearAllTitle: "حذف جميع المستندات",
    
    // Evaluation Tab Keys
    runEvals: "تشغيل التقييم",
    runningEvals: "جاري تشغيل التقييم...",
    noEvals: "لم يتم تشغيل أي تقييمات بعد",
    pastRuns: "سجل التقييمات السابقة",
    casesHeader: "حالات التقييم",
    accuracy: "الدقة الإجمالية",
    avgFaithfulness: "متوسط الأمانة",
    totalCases: "إجمالي الحالات",
    languageBreakdown: "تحليل اللغات",
    caseQuestion: "السؤال",
    caseExpected: "الإجابة المتوقعة",
    caseGenerated: "الإجابة المنشأة",
    caseStatus: "الحالة",
    caseFaithfulness: "الأمانة",
    caseReason: "تفسير الحكم",
    editCase: "تعديل حالة التقييم",
    saveChanges: "حفظ التغييرات",
    cancel: "إلغاء",
    warnNoDocs: "تحذير: يجب عليك تحميل مستند واحد على الأقل والانتظار حتى يصبح جاهزاً قبل تشغيل التقييمات.",
    passed: "ناجح",
    failedLabel: "راسب",
    errorJudge: "خطأ في الحكم",
    runDate: "التاريخ",
    arCases: "العربية",
    enCases: "الإنجليزية",
    correctLabel: "صحيح",
    incorrectLabel: "خاطئ"
  }
}

// Session management helper
const getSessionId = (): string => {
  let sessionId = localStorage.getItem('mersal_session_id')
  if (!sessionId) {
    sessionId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'session-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('mersal_session_id', sessionId)
  }
  return sessionId
}

export default function App() {
  const [sessionId] = useState(getSessionId)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [uploadState, setUploadState] = useState<'idle' | 'dragging' | 'uploading' | 'extracting'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [activeTab, setActiveTab] = useState<'documents' | 'chat' | 'evaluation'>('documents')
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({})
  
  // Evaluation States
  const [evalCases, setEvalCases] = useState<EvalCase[]>([])
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([])
  const [evalRunning, setEvalRunning] = useState(false)
  const [evalProgress, setEvalProgress] = useState<{ current: number; total: number } | null>(null)
  const [editingCase, setEditingCase] = useState<EvalCase | null>(null)
  const [editQuestion, setEditQuestion] = useState('')
  const [editExpectedAnswer, setEditExpectedAnswer] = useState('')
  const [expandedCaseResult, setExpandedCaseResult] = useState<Record<string, boolean>>({})
  const [reRunningCaseId, setReRunningCaseId] = useState<string | null>(null)

  const [language, setLanguageState] = useState<'en' | 'ar'>(() => {
    const stored = localStorage.getItem('mersal_language')
    return (stored === 'ar' || stored === 'en') ? stored : 'en'
  })

  const setLanguage = (lang: 'en' | 'ar') => {
    localStorage.setItem('mersal_language', lang)
    setLanguageState(lang)
  }

  const pollIntervalRef = useRef<number | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const abortEvalRef = useRef(false)

  const t = translations[language]

  // Fetch documents for the current session
  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch('/api/documents', {
        headers: {
          'x-session-id': sessionId
        }
      })
      if (!response.ok) {
        throw new Error('Failed to load documents')
      }
      const data = await response.json()
      setDocuments(data)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Connection to server failed.')
    }
  }, [sessionId])

  // Fetch chat history for the current session
  const fetchChatHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/chat', {
        headers: {
          'x-session-id': sessionId
        }
      })
      if (!response.ok) {
        throw new Error('Failed to load chat history')
      }
      const data = await response.json()
      setMessages(data)
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Failed to load chat history.')
    }
  }, [sessionId])

  // Fetch evaluation cases and history
  const fetchEvalsData = useCallback(async () => {
    try {
      const [casesRes, runsRes] = await Promise.all([
        fetch('/api/evals/cases'),
        fetch('/api/evals/runs')
      ])
      if (casesRes.ok) {
        const casesData = await casesRes.json()
        setEvalCases(casesData)
      }
      if (runsRes.ok) {
        const runsData = await runsRes.json()
        setEvalRuns(runsData)
      }
    } catch (err) {
      console.error('Failed to load evaluation data', err)
    }
  }, [])

  // Initial fetch on mount
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchDocuments(),
      fetchChatHistory(),
      fetchEvalsData()
    ]).finally(() => setLoading(false))
  }, [fetchDocuments, fetchChatHistory, fetchEvalsData])

  // Auto-scroll to bottom of chat log
  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (activeTab === 'chat') {
      scrollToBottom()
    }
  }, [messages, chatLoading, activeTab, scrollToBottom])

  // Setup smart auto-polling if any document is in 'processing' state
  useEffect(() => {
    const hasProcessing = documents.some(doc => doc.status === 'processing')

    if (hasProcessing) {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = window.setInterval(() => {
          fetchDocuments()
        }, 2000) // Poll every 2 seconds
      }
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [documents, fetchDocuments])

  // Handle Drag Events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true)
      setUploadState('dragging')
    } else if (e.type === 'dragleave') {
      setIsDragActive(false)
      setUploadState('idle')
    }
  }

  // Handle Upload
  const uploadFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMsg('Only PDF files are supported.')
      setUploadState('idle')
      return
    }

    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      setErrorMsg('Maximum file size is 10MB.')
      setUploadState('idle')
      return
    }

    setErrorMsg(null)
    setUploadState('uploading')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: {
          'x-session-id': sessionId
        },
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to upload document.')
      }

      setUploadState('extracting')
      await fetchDocuments()
      setUploadState('idle')
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during upload.')
      setUploadState('idle')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadFile(e.dataTransfer.files[0])
    } else {
      setUploadState('idle')
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      uploadFile(e.target.files[0])
    }
  }

  // Delete a specific document
  const handleDelete = async (docId: string) => {
    setErrorMsg(null)
    try {
      const response = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
        headers: {
          'x-session-id': sessionId
        }
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete document.')
      }
      await fetchDocuments()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Failed to delete document.')
    }
  }

  // Clear all documents in the session
  const handleClearAll = async () => {
    if (!window.confirm(t.confirmClearAll)) {
      return
    }
    setErrorMsg(null)
    setLoading(true)
    try {
      const response = await fetch('/api/documents', {
        method: 'DELETE',
        headers: {
          'x-session-id': sessionId
        }
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to clear documents.')
      }
      await fetchDocuments()
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Failed to clear documents.')
    } finally {
      setLoading(false)
    }
  }

  // Send message to assistant
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim() || chatLoading) return

    const userQuestion = question.trim()
    setQuestion('')
    setErrorMsg(null)
    setChatLoading(true)

    // Optimistically add user message to list
    const tempUserMsgId = 'temp-' + Date.now()
    const newMsg: Message = {
      id: tempUserMsgId,
      role: 'user',
      content: userQuestion,
      created_at: Math.floor(Date.now() / 1000)
    }
    setMessages(prev => [...prev, newMsg])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({ question: userQuestion })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to get answer.')
      }

      const data = await response.json()
      
      // Add assistant response
      const assistantMsg: Message = {
        id: 'msg-' + Date.now(),
        role: 'assistant',
        content: data.answer,
        chunks: data.chunks,
        created_at: Math.floor(Date.now() / 1000)
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Failed to send message.')
    } finally {
      setChatLoading(false)
    }
  }

  // Abort handler
  const handleAbortEvaluations = () => {
    abortEvalRef.current = true
  }

  // Frontend-driven sequential evaluation run loop (with a 9-second rate limit delay)
  const handleRunEvaluations = async () => {
    const hasReadyDocs = documents.some(doc => doc.status === 'ready')
    if (!hasReadyDocs) {
      setErrorMsg(t.warnNoDocs)
      return
    }

    setErrorMsg(null)
    setEvalRunning(true)
    setEvalProgress({ current: 0, total: evalCases.length })
    abortEvalRef.current = false

    let runId: string | null = null
    let consecutiveQuotaExhausted = 0

    try {
      // 1. Initialize run and reset D1 cases results
      const initRes = await fetch('/api/evals/run', {
        method: 'POST',
        headers: {
          'x-session-id': sessionId
        }
      })
      if (!initRes.ok) {
        const errorData = await initRes.json()
        throw new Error(errorData.error || 'Failed to start evaluation run.')
      }
      const initData = await initRes.json()
      runId = initData.runId

      // Reset the local cases list display first
      setEvalCases(prev => prev.map(c => ({ ...c, last_result: null, last_score: null })))

      // 2. Loop sequentially through cases
      for (let i = 0; i < evalCases.length; i++) {
        // Check for manual user abort
        if (abortEvalRef.current) {
          setErrorMsg(language === 'en' ? 'Evaluation run aborted by user.' : 'تم إلغاء تشغيل التقييم من قبل المستخدم.')
          break
        }

        const kase = evalCases[i]
        setEvalProgress({ current: i + 1, total: evalCases.length })

        // Evaluate single case
        const caseRes = await fetch(`/api/evals/run-case/${kase.id}`, {
          method: 'POST',
          headers: {
            'x-session-id': sessionId
          }
        })

        if (caseRes.ok) {
          const caseData = await caseRes.json()
          
          // Form the simulated last_result string for local UI update
          const resultObj = {
            correct: caseData.correct,
            faithfulness: caseData.faithfulness,
            reason: caseData.reason,
            answer: caseData.generated_answer,
            error: caseData.error
          }

          // Live update local state to show progress ticks
          setEvalCases(prev => prev.map(c => 
            c.id === kase.id 
              ? { ...c, last_result: JSON.stringify(resultObj), last_score: caseData.faithfulness } 
              : c
          ))

          // Check for daily quota exhaustion
          if (caseData.error === 'QUOTA_EXHAUSTED') {
            consecutiveQuotaExhausted++
            if (consecutiveQuotaExhausted >= 3) {
              setErrorMsg(
                language === 'en'
                  ? 'Evaluation run auto-aborted: 3 consecutive daily quota errors encountered. Please retry after daily reset.'
                  : 'تم إيقاف التقييم تلقائياً: تم مواجهة 3 أخطاء متتالية لنفاذ الحصة اليومية. يرجى المحاولة بعد إعادة تعيين الحصة اليومية.'
              )
              break
            }
          } else {
            // Reset consecutive counter on non-quota-exhausted results
            consecutiveQuotaExhausted = 0
          }
        } else {
          // If the network call failed completely, mark as execution error
          const resultObj = {
            correct: false,
            faithfulness: 0,
            reason: 'HTTP request failed or server error.',
            answer: '',
            error: 'HTTP_REQUEST_FAILED'
          }
          setEvalCases(prev => prev.map(c => 
            c.id === kase.id 
              ? { ...c, last_result: JSON.stringify(resultObj), last_score: 0 } 
              : c
          ))
          consecutiveQuotaExhausted = 0
        }

        // Apply a strict 9-second delay between cases to satisfy 10 RPM Gemini Free tier limits (except the last case)
        if (i < evalCases.length - 1) {
          // Check for manual abort in a loop during the 9s delay to abort immediately
          let slept = 0
          const step = 200
          while (slept < 9000) {
            if (abortEvalRef.current) {
              break
            }
            await new Promise(resolve => setTimeout(resolve, step))
            slept += step
          }
          if (abortEvalRef.current) {
            setErrorMsg(language === 'en' ? 'Evaluation run aborted by user.' : 'تم إلغاء تشغيل التقييم من قبل المستخدم.')
            break
          }
        }
      }

      // 3. Finalize run totals (even if aborted, complete run to save aggregate stats)
      if (runId) {
        const completeRes = await fetch('/api/evals/complete-run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': sessionId
          },
          body: JSON.stringify({ runId })
        })

        if (completeRes.ok) {
          await fetchEvalsData()
        }
      }
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'An error occurred during evaluation run.')
    } finally {
      setEvalRunning(false)
      setEvalProgress(null)
    }
  }

  // Run evaluation for a single case
  const handleReRunSingleCase = async (caseId: string) => {
    const hasReadyDocs = documents.some(doc => doc.status === 'ready')
    if (!hasReadyDocs) {
      setErrorMsg(t.warnNoDocs)
      return
    }

    setErrorMsg(null)
    setReRunningCaseId(caseId)

    try {
      const caseRes = await fetch(`/api/evals/run-case/${caseId}`, {
        method: 'POST',
        headers: {
          'x-session-id': sessionId
        }
      })

      if (caseRes.ok) {
        const caseData = await caseRes.json()
        
        const resultObj = {
          correct: caseData.correct,
          faithfulness: caseData.faithfulness,
          reason: caseData.reason,
          answer: caseData.generated_answer,
          error: caseData.error
        }

        // Live update local state for this specific case
        setEvalCases(prev => prev.map(c => 
          c.id === caseId 
            ? { ...c, last_result: JSON.stringify(resultObj), last_score: caseData.faithfulness } 
            : c
        ))
      } else {
        const resultObj = {
          correct: false,
          faithfulness: 0,
          reason: 'HTTP request failed or server error.',
          answer: '',
          error: 'HTTP_REQUEST_FAILED'
        }
        setEvalCases(prev => prev.map(c => 
          c.id === caseId 
            ? { ...c, last_result: JSON.stringify(resultObj), last_score: 0 } 
            : c
        ))
      }
    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Failed to re-run case.')
    } finally {
      setReRunningCaseId(null)
    }
  }

  // Edit case handler
  const handleEditCaseClick = (kase: EvalCase) => {
    setEditingCase(kase)
    setEditQuestion(kase.question)
    setEditExpectedAnswer(kase.expected_answer)
  }

  const handleSaveCaseEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCase || !editQuestion.trim() || !editExpectedAnswer.trim()) return

    try {
      const response = await fetch(`/api/evals/cases/${editingCase.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId
        },
        body: JSON.stringify({
          question: editQuestion.trim(),
          expected_answer: editExpectedAnswer.trim()
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update case.')
      }

      await fetchEvalsData()
      setEditingCase(null)
    } catch (err: any) {
      console.error(err)
      alert(err.message || 'Failed to save case.')
    }
  }

  // Helper to format character counts nicely
  const formatCharCount = (count: number) => {
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1) + 'M'
    }
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k'
    }
    return count
  }

  // Evaluation calculations
  const totalCases = evalCases.length
  const evaluatedCasesList = evalCases.filter(c => c.last_result !== null)
  const correctCases = evalCases.filter(c => {
    if (!c.last_result) return false
    try {
      const parsed = JSON.parse(c.last_result)
      return parsed.correct && !parsed.error
    } catch {
      return false
    }
  })

  const overallAccuracy = evaluatedCasesList.length > 0
    ? Math.round((correctCases.length / evaluatedCasesList.length) * 100)
    : 0

  const averageFaithfulness = (() => {
    let sum = 0
    let count = 0
    evalCases.forEach(c => {
      if (c.last_result) {
        try {
          const parsed = JSON.parse(c.last_result)
          if (typeof parsed.faithfulness === 'number' && !parsed.error) {
            sum += parsed.faithfulness
            count++
          }
        } catch {}
      }
    })
    return count > 0 ? Math.round(sum / count) : 0
  })()

  // Language stats
  const arabicCases = evalCases.filter(c => c.language === 'ar')
  const arabicEvaluated = arabicCases.filter(c => c.last_result !== null)
  const arabicCorrect = arabicCases.filter(c => {
    if (!c.last_result) return false
    try {
      const parsed = JSON.parse(c.last_result)
      return parsed.correct && !parsed.error
    } catch { return false }
  })
  const arAccuracy = arabicEvaluated.length > 0 ? Math.round((arabicCorrect.length / arabicEvaluated.length) * 100) : 0

  const englishCases = evalCases.filter(c => c.language === 'en')
  const englishEvaluated = englishCases.filter(c => c.last_result !== null)
  const englishCorrect = englishCases.filter(c => {
    if (!c.last_result) return false
    try {
      const parsed = JSON.parse(c.last_result)
      return parsed.correct && !parsed.error
    } catch { return false }
  })
  const enAccuracy = englishEvaluated.length > 0 ? Math.round((englishCorrect.length / englishEvaluated.length) * 100) : 0

  const hasReadyDocs = documents.some(doc => doc.status === 'ready')

  return (
    <div 
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-brand-500/30 selection:text-white"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Top Navigation */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3 rtl:space-x-reverse">
          <div className="bg-gradient-to-tr from-brand-600 to-blue-500 p-2.5 rounded-xl shadow-lg shadow-brand-500/10">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400">
              {t.title} <span className="font-arabic font-semibold text-brand-400 ml-1 rtl:mr-1 rtl:ml-0">{language === 'en' ? 'مرسال' : 'Mersal'}</span>
            </h1>
            <p className="text-[10px] text-slate-500 tracking-wider uppercase font-light">{t.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center space-x-4 rtl:space-x-reverse">
          {/* Bilingual Language Switcher Toggle */}
          <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800/80 text-xxs font-semibold">
            <button
              onClick={() => setLanguage('en')}
              className={`px-2.5 py-1 rounded transition-colors ${
                language === 'en' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              English
            </button>
            <button
              onClick={() => setLanguage('ar')}
              className={`px-2.5 py-1 rounded transition-colors font-arabic ${
                language === 'ar' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              العربية
            </button>
          </div>

          <div className="hidden md:flex items-center space-x-2 rtl:space-x-reverse text-xs text-slate-500 bg-slate-900/40 px-3 py-1.5 rounded-lg border border-slate-800/60">
            <span>{t.session}:</span>
            <span className="font-mono text-slate-400 select-all">{sessionId.substring(0, 8)}...</span>
          </div>
        </div>
      </header>

      {/* Tab Selection */}
      <div className="max-w-7xl w-full mx-auto px-6 pt-6">
        <div className="flex border-b border-slate-900 space-x-6 rtl:space-x-reverse">
          <button
            onClick={() => setActiveTab('documents')}
            className={`pb-3 text-sm font-semibold transition-all border-b-2 px-1 flex items-center space-x-2 rtl:space-x-reverse ${
              activeTab === 'documents'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{t.tabDocuments}</span>
            <span className="bg-slate-900 text-slate-400 px-2 py-0.5 rounded-full text-[10px] border border-slate-800">
              {documents.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`pb-3 text-sm font-semibold transition-all border-b-2 px-1 ${
              activeTab === 'chat'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.tabChat}
          </button>
          <button
            onClick={() => setActiveTab('evaluation')}
            className={`pb-3 text-sm font-semibold transition-all border-b-2 px-1 ${
              activeTab === 'evaluation'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.tabEvaluation}
          </button>
        </div>
      </div>

      {activeTab === 'documents' && (
        /* Main Workspace Layout */
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Area: Upload Portal & Alerts */}
          <section className="lg:col-span-4 flex flex-col space-y-6">
            <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm flex flex-col space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-200">{t.uploadTitle}</h2>
                <p className="text-xs text-slate-400 font-light mt-1">
                  {t.uploadSubtitle}
                </p>
              </div>

              {/* Drag and Drop Zone */}
              <label
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 group overflow-hidden ${
                  isDragActive
                    ? 'border-brand-500 bg-brand-950/20 shadow-[0_0_20px_rgba(72,108,178,0.15)]'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-900/20 hover:bg-slate-900/40'
                }`}
              >
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={uploadState !== 'idle'}
                />
                
                {uploadState === 'idle' && (
                  <div className="flex flex-col items-center space-y-3 text-center">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-900 group-hover:scale-110 transition-transform duration-300">
                      <UploadCloud className="w-6 h-6 text-slate-400 group-hover:text-brand-400 transition-colors" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-300">{t.dragDrop}</p>
                      <p className="text-xs text-slate-500 mt-1">{t.clickBrowse}</p>
                    </div>
                  </div>
                )}

                {uploadState === 'dragging' && (
                  <div className="flex flex-col items-center space-y-2 text-center pointer-events-none">
                    <UploadCloud className="w-8 h-8 text-brand-500 animate-bounce" />
                    <p className="text-sm font-semibold text-brand-400">{t.dragDrop}</p>
                  </div>
                )}

                {uploadState === 'uploading' && (
                  <div className="flex flex-col items-center space-y-3 text-center pointer-events-none">
                    <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                    <p className="text-sm font-medium text-slate-300">{t.uploading}</p>
                    <p className="text-xs text-slate-500">{t.storingR2}</p>
                  </div>
                )}

                {uploadState === 'extracting' && (
                  <div className="flex flex-col items-center space-y-3 text-center pointer-events-none">
                    <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
                    <p className="text-sm font-medium text-brand-400">{t.extracting}</p>
                    <p className="text-xs text-slate-400 animate-pulse">{t.runningUnpdf}</p>
                  </div>
                )}
              </label>

              {/* Error Message Toast */}
              {errorMsg && (
                <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-3 flex items-start space-x-3 rtl:space-x-reverse text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold">{t.error}</p>
                    <p className="text-[11px] text-rose-400/90 mt-0.5">{errorMsg}</p>
                  </div>
                  <button
                    onClick={() => setErrorMsg(null)}
                    className="text-rose-400 hover:text-white transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* Cloudflare Worker CPU limits flag */}
            <div className="bg-slate-900/20 border border-slate-900/60 rounded-xl p-4 text-[11px] text-slate-500 space-y-2 leading-relaxed">
              <p className="font-semibold text-slate-400 flex items-center">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500/80 mr-1.5 ml-1.5 flex-shrink-0" />
                {t.technicalLimits}
              </p>
              <p>* {t.limit1}</p>
              <p>* {t.limit2}</p>
            </div>
          </section>

          {/* Right Area: Document Listing */}
          <section className="lg:col-span-8 flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                <h2 className="text-lg font-bold text-slate-200">{t.documentsHeader}</h2>
                <span className="bg-slate-900 text-slate-400 px-2 py-0.5 rounded-full text-xs border border-slate-800">
                  {documents.length}
                </span>
              </div>
              <div className="flex items-center space-x-2 rtl:space-x-reverse">
                {documents.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    disabled={loading}
                    className="text-xs text-rose-400 hover:text-white hover:bg-rose-950/20 px-3 py-1.5 rounded-lg border border-rose-950/30 transition-colors flex items-center space-x-1.5 rtl:space-x-reverse disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.clearAll}</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setLoading(true)
                    fetchDocuments().finally(() => setLoading(false))
                  }}
                  disabled={loading}
                  className="text-xs text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-850 px-3 py-1.5 rounded-lg border border-slate-800 transition-colors flex items-center space-x-1.5 rtl:space-x-reverse disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>{t.refresh}</span>
                </button>
              </div>
            </div>

            {loading && documents.length === 0 ? (
              <div className="flex-1 bg-slate-900/10 border border-slate-900/50 rounded-2xl p-16 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                <p className="text-sm text-slate-400">{t.loadingLibrary}</p>
              </div>
            ) : documents.length === 0 ? (
              /* Empty State */
              <div className="flex-1 bg-slate-900/10 border border-slate-900/50 rounded-2xl p-16 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-14 h-14 bg-slate-900/80 rounded-full flex items-center justify-center border border-slate-800 text-slate-500">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-300">{t.noDocs}</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                    {t.noDocsDesc}
                  </p>
                </div>
              </div>
            ) : (
              /* Document Cards List */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={`bg-slate-900/30 border rounded-xl p-5 hover:bg-slate-900/50 transition-all duration-305 flex flex-col justify-between group hover:-translate-y-0.5 shadow-md ${
                      doc.status === 'failed'
                        ? 'border-rose-950/50'
                        : doc.status === 'processing'
                        ? 'border-amber-950/40'
                        : 'border-slate-900 hover:border-slate-800'
                    }`}
                  >
                    <div className="space-y-3">
                      {/* Header: icon & badges */}
                      <div className="flex items-start justify-between">
                        <div className="p-2 bg-slate-950 rounded-lg group-hover:scale-105 transition-transform border border-slate-900">
                          <FileText className={`w-5 h-5 ${
                            doc.status === 'failed' ? 'text-rose-400' : doc.status === 'processing' ? 'text-amber-400 animate-pulse' : 'text-brand-400'
                          }`} />
                        </div>
                        
                        <div className="flex items-center space-x-1.5 rtl:space-x-reverse">
                          {/* Language Badge */}
                          {doc.status === 'ready' && doc.language && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                              doc.language === 'ar'
                                ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/40 font-arabic'
                                : 'bg-blue-950/20 text-blue-400 border-blue-900/40'
                            }`}>
                              {doc.language === 'ar' ? 'العربية' : 'EN'}
                            </span>
                          )}

                          {/* Status Badge */}
                          {doc.status === 'processing' && (
                            <span className="bg-amber-950/30 text-amber-400 border border-amber-900/40 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center space-x-1 rtl:space-x-reverse">
                              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping mr-1 ml-1"></span>
                              <span>{t.processing}</span>
                            </span>
                          )}
                          {doc.status === 'ready' && (
                            <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900/40 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center space-x-1 rtl:space-x-reverse">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400 mr-0.5 ml-0.5" />
                              <span>{t.ready}</span>
                            </span>
                          )}
                          {doc.status === 'failed' && (
                            <span className="bg-rose-950/30 text-rose-400 border border-rose-900/40 text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center space-x-1 rtl:space-x-reverse">
                              <AlertCircle className="w-3 h-3 text-rose-400 mr-0.5 ml-0.5" />
                              <span>{t.failed}</span>
                            </span>
                          )}

                          {/* Delete Button */}
                          {doc.status !== 'processing' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(doc.id)
                              }}
                              className="text-slate-500 hover:text-rose-400 p-1.5 rounded hover:bg-rose-950/20 transition-colors ml-1 mr-1"
                              title="Delete document"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Title */}
                      <div>
                        <h3 className="font-semibold text-sm text-slate-200 line-clamp-1 group-hover:text-white transition-colors" title={doc.filename}>
                          {doc.filename}
                        </h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          {new Date(doc.created_at * 1000).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Metadata Row / Error Message */}
                    <div className="mt-5 pt-3 border-t border-slate-900/80">
                      {doc.status === 'ready' ? (
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-light">{t.pages}</span>
                            <span className="font-medium text-slate-300 mt-0.5">{doc.page_count}</span>
                          </div>
                          <div className="flex flex-col items-end rtl:items-start">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-light">{t.length}</span>
                            <span className="font-medium text-slate-300 mt-0.5">{formatCharCount(doc.character_count)} {t.chars}</span>
                          </div>
                        </div>
                      ) : doc.status === 'failed' ? (
                        <div className="text-[11px] text-rose-400 leading-normal flex items-start space-x-1 rtl:space-x-reverse">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-rose-500 flex-shrink-0" />
                          <span>{doc.error_message || 'Text extraction failed.'}</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-amber-500 flex items-center space-x-1.5 rtl:space-x-reverse py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                          <span>{t.extractingPages}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {activeTab === 'chat' && (
        /* Chat Q&A Panel Layout */
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col">
          {errorMsg && (
            <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-3 flex items-start space-x-3 rtl:space-x-reverse text-rose-300 text-xs mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">{t.error}</p>
                <p className="text-[11px] text-rose-400/90 mt-0.5">{errorMsg}</p>
              </div>
              <button
                onClick={() => setErrorMsg(null)}
                className="text-rose-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
          )}

          <div className="flex flex-col h-[65vh] bg-slate-900/10 border border-slate-900 rounded-2xl overflow-hidden shadow-lg backdrop-blur-sm">
            {/* Messages View */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-slate-500">
                  <div className="w-14 h-14 bg-slate-900/80 rounded-full flex items-center justify-center border border-slate-800 text-slate-500">
                    <Sparkles className="w-6 h-6 text-brand-500 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-300">{t.askAnything}</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                      {t.askAnythingDesc}
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    {/* Message Bubble */}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-brand-600 text-white rounded-tr-none rtl:rounded-tr-2xl rtl:rounded-tl-none'
                          : 'bg-slate-900 border border-slate-850 text-slate-200 rounded-tl-none rtl:rounded-tl-2xl rtl:rounded-tr-none'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>

                    {/* Sources (Citations) with slide-down CSS animation */}
                    {msg.role === 'assistant' && msg.chunks && msg.chunks.length > 0 && (
                      <div className="mt-1 w-[85%]">
                        <button
                          onClick={() => {
                            setExpandedSources(prev => ({
                              ...prev,
                              [msg.id]: !prev[msg.id]
                            }))
                          }}
                          className="text-[11px] text-brand-400 hover:text-brand-300 font-medium flex items-center space-x-1.5 rtl:space-x-reverse py-1 transition-colors"
                        >
                          <span>{expandedSources[msg.id] ? t.hideSources : t.viewSources}</span>
                          <span className="bg-slate-900 text-slate-400 px-1.5 py-0.2 rounded-full border border-slate-800 text-[10px]">
                            {msg.chunks.length}
                          </span>
                        </button>
                        
                        {/* Slide-down transition wrapper */}
                        <div className={`grid transition-all duration-300 ease-in-out overflow-hidden ${
                          expandedSources[msg.id] ? 'grid-rows-[1fr] opacity-100 mt-1.5' : 'grid-rows-[0fr] opacity-0'
                        }`}>
                          <div className="overflow-hidden">
                            <div className="p-4 bg-slate-900/30 border border-slate-900 rounded-xl space-y-3 text-xs max-h-60 overflow-y-auto">
                              {msg.chunks.map((chunk: any, idx: number) => (
                                <div key={chunk.id || idx} className="space-y-1.5 pb-2.5 border-b border-slate-950/40 last:border-0 last:pb-0">
                                  <p className="font-semibold text-slate-300 flex items-center justify-between rtl:flex-row-reverse">
                                    <span className="truncate max-w-[70%]">{chunk.filename}</span>
                                    <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-850 whitespace-nowrap">
                                      {language === 'en' ? `Page ${chunk.page_number}` : `الصفحة ${chunk.page_number}`}
                                    </span>
                                  </p>
                                  <p className="text-[11px] text-slate-400 italic bg-slate-950/40 p-2.5 rounded border border-slate-900/30 leading-normal">
                                    "{chunk.text}"
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Chat Loading State */}
              {chatLoading && (
                <div className="flex flex-col items-start">
                  <div className="bg-slate-900 border border-slate-850 text-slate-350 rounded-2xl rounded-tl-none rtl:rounded-tl-2xl rtl:rounded-tr-none px-4 py-2.5 max-w-[80%] flex items-center space-x-2 rtl:space-x-reverse">
                    <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                    <span className="text-xs text-slate-400">{t.thinking}</span>
                  </div>
                </div>
              )}
              
              {/* Ref anchor for automatic scrolling */}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-900 bg-slate-950/60 backdrop-blur-md flex items-center space-x-3 rtl:space-x-reverse">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t.placeholder}
                disabled={chatLoading}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!question.trim() || chatLoading}
                className="bg-brand-600 hover:bg-brand-500 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:hover:bg-brand-600 flex items-center space-x-1.5 rtl:space-x-reverse"
              >
                <span>{t.send}</span>
              </button>
            </form>
          </div>
        </main>
      )}

      {activeTab === 'evaluation' && (
        /* Evaluation Dashboard View */
        <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col space-y-6">
          {errorMsg && (
            <div className="bg-rose-950/30 border border-rose-900/50 rounded-xl p-3 flex items-start space-x-3 rtl:space-x-reverse text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">{t.error}</p>
                <p className="text-[11px] text-rose-400/90 mt-0.5">{errorMsg}</p>
              </div>
              <button
                onClick={() => setErrorMsg(null)}
                className="text-rose-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
          )}

          {/* Warning banner if no documents ready */}
          {!hasReadyDocs && (
            <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-4 flex items-start space-x-3 rtl:space-x-reverse text-amber-300 text-xs">
              <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-500" />
              <div>
                <p className="font-bold text-sm">{language === 'en' ? 'No Indexed Documents' : 'لا توجد مستندات مفهرسة'}</p>
                <p className="mt-1 leading-normal text-slate-300">{t.warnNoDocs}</p>
              </div>
            </div>
          )}

          {/* Action Header & Progress Card */}
          <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-slate-200">{t.tabEvaluation}</h2>
              <p className="text-xs text-slate-400 leading-normal">
                {language === 'en'
                  ? 'Runs RAG QA queries against your seeded cases, using gemini-3.1-flash-lite as judge to rate correctness & faithfulness.'
                  : 'تشغيل أسئلة التطوير مقابل الحالات المخزنة وتقييمها بـ gemini-3.1-flash-lite للتأكد من الدقة الفنية.'}
              </p>
            </div>
            
            <div className="flex flex-col items-end rtl:items-start space-y-2">
              {evalRunning ? (
                <div className="flex items-center space-x-2 rtl:space-x-reverse">
                  <button
                    disabled={true}
                    className="bg-brand-950/30 text-brand-400 border border-brand-900/40 rounded-xl px-5 py-3 text-sm font-semibold flex items-center space-x-2 rtl:space-x-reverse cursor-not-allowed animate-pulse"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.runningEvals}</span>
                  </button>
                  <button
                    onClick={handleAbortEvaluations}
                    className="bg-rose-950/40 hover:bg-rose-900 border border-rose-900/50 hover:border-rose-700 text-rose-400 hover:text-white rounded-xl px-4 py-3 text-sm font-semibold transition-colors flex items-center space-x-1.5 rtl:space-x-reverse shadow-md shadow-rose-950/20"
                    title="Abort active evaluation run"
                  >
                    <AlertCircle className="w-4 h-4" />
                    <span>{language === 'en' ? 'Abort' : 'إلغاء'}</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleRunEvaluations}
                  disabled={!hasReadyDocs}
                  className="bg-brand-600 hover:bg-brand-500 text-white rounded-xl px-5 py-3 text-sm font-semibold transition-colors disabled:opacity-50 flex items-center space-x-2 rtl:space-x-reverse shadow-md shadow-brand-500/10"
                >
                  <Activity className="w-4 h-4" />
                  <span>{t.runEvals}</span>
                </button>
              )}
              
              {/* Sequential Progress Bar */}
              {evalProgress && (
                <div className="w-full md:w-60 space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>{language === 'en' ? 'Evaluating Case' : 'تقييم حالة'}</span>
                    <span>{evalProgress.current} / {evalProgress.total}</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-900">
                    <div 
                      className="h-full bg-gradient-to-r from-brand-600 to-blue-500 transition-all duration-300"
                      style={{ width: `${(evalProgress.current / evalProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stats Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex items-center space-x-4 rtl:space-x-reverse">
              <div className="p-3 bg-brand-950/30 border border-brand-900/30 rounded-lg text-brand-400">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xxs text-slate-500 uppercase tracking-wider font-light">{t.accuracy}</p>
                <p className="text-2xl font-bold text-slate-200 mt-1">{overallAccuracy}%</p>
              </div>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex items-center space-x-4 rtl:space-x-reverse">
              <div className="p-3 bg-blue-950/30 border border-blue-900/30 rounded-lg text-blue-400">
                <ThumbsUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xxs text-slate-500 uppercase tracking-wider font-light">{t.avgFaithfulness}</p>
                <p className="text-2xl font-bold text-slate-200 mt-1">{averageFaithfulness}/100</p>
              </div>
            </div>

            <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex items-center space-x-4 rtl:space-x-reverse">
              <div className="p-3 bg-slate-950 border border-slate-900 rounded-lg text-slate-400">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xxs text-slate-500 uppercase tracking-wider font-light">{t.totalCases}</p>
                <p className="text-2xl font-bold text-slate-200 mt-1">{totalCases}</p>
              </div>
            </div>

            {/* Language Breakdown Card */}
            <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-5 flex flex-col justify-center space-y-1">
              <p className="text-xxs text-slate-500 uppercase tracking-wider font-light">{t.languageBreakdown}</p>
              <div className="flex justify-between text-xs text-slate-350 pt-1">
                <span>{t.enCases}:</span>
                <span className="font-mono font-semibold">{enAccuracy}% accuracy</span>
              </div>
              <div className="flex justify-between text-xs text-slate-350">
                <span>{t.arCases}:</span>
                <span className="font-mono font-semibold font-arabic">{arAccuracy}% accuracy</span>
              </div>
            </div>
          </div>

          {/* Main Grid: Cases Editor vs Runs History */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* Left/Middle Column: Cases List */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">{t.casesHeader}</h3>
              </div>
              
              <div className="bg-slate-900/10 border border-slate-900 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left rtl:text-right border-collapse">
                    <thead>
                      <tr className="border-b border-slate-900 bg-slate-900/40 text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                        <th className="py-3 px-4 w-12 text-center">Lang</th>
                        <th className="py-3 px-4">{t.caseQuestion}</th>
                        <th className="py-3 px-4">{t.caseExpected}</th>
                        <th className="py-3 px-4 w-28 text-center">{t.caseStatus}</th>
                        <th className="py-3 px-4 w-12 text-center">Score</th>
                        <th className="py-3 px-4 w-12 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/60 text-xs">
                      {evalCases.map((kase) => {
                        let parsedResult: any = null
                        if (kase.last_result) {
                          try {
                            parsedResult = JSON.parse(kase.last_result)
                          } catch {}
                        }

                        return (
                          <tr key={kase.id} className="hover:bg-slate-900/25 transition-colors">
                            {/* Lang */}
                            <td className="py-3 px-4 text-center">
                              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                                kase.language === 'ar'
                                  ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/40 font-arabic'
                                  : 'bg-blue-950/20 text-blue-400 border-blue-900/40'
                              }`}>
                                {kase.language.toUpperCase()}
                              </span>
                            </td>
                            
                            {/* Question */}
                            <td className="py-3 px-4 font-medium text-slate-200">
                              <div className="line-clamp-2 max-w-[200px]" title={kase.question}>
                                {kase.question}
                              </div>
                            </td>

                            {/* Reference */}
                            <td className="py-3 px-4 text-slate-400">
                              <div className="line-clamp-2 max-w-[200px]" title={kase.expected_answer}>
                                {kase.expected_answer}
                              </div>
                            </td>

                            {/* Status Judgment Badge */}
                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              {!parsedResult ? (
                                <span className="text-[10px] text-slate-500 font-mono">-</span>
                              ) : parsedResult.error ? (
                                <span className="bg-amber-950/30 text-amber-400 border border-amber-900/40 text-[10px] font-medium px-2 py-0.5 rounded-full">
                                  {t.errorJudge}
                                </span>
                              ) : parsedResult.correct ? (
                                <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900/40 text-[10px] font-medium px-2 py-0.5 rounded-full">
                                  {t.passed}
                                </span>
                              ) : (
                                <span className="bg-rose-950/30 text-rose-400 border border-rose-900/40 text-[10px] font-medium px-2 py-0.5 rounded-full">
                                  {t.failedLabel}
                                </span>
                              )}
                            </td>

                            {/* Faithfulness Score */}
                            <td className="py-3 px-4 text-center font-mono font-semibold">
                              {!parsedResult || parsedResult.error ? '-' : `${parsedResult.faithfulness}`}
                            </td>

                            {/* Actions / View Details */}
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center space-x-2 rtl:space-x-reverse">
                                <button
                                  onClick={() => handleEditCaseClick(kase)}
                                  className="text-slate-500 hover:text-white p-1 hover:bg-slate-900 rounded transition-colors"
                                  title="Edit case"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleReRunSingleCase(kase.id)}
                                  disabled={evalRunning || reRunningCaseId !== null || !documents.some(doc => doc.status === 'ready')}
                                  className="text-slate-500 hover:text-brand-400 p-1 hover:bg-slate-900 rounded transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                  title="Run evaluation for this case"
                                >
                                  {reRunningCaseId === kase.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                                  ) : (
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                {parsedResult && (
                                  <button
                                    onClick={() => {
                                      setExpandedCaseResult(prev => ({
                                        ...prev,
                                        [kase.id]: !prev[kase.id]
                                      }))
                                    }}
                                    className="text-brand-400 hover:text-brand-300 text-[10px] font-semibold"
                                  >
                                    {expandedCaseResult[kase.id] ? '✕' : 'Details'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Expanded details cards */}
              {evalCases.map((kase) => {
                if (!expandedCaseResult[kase.id] || !kase.last_result) return null
                let parsed: any = {}
                try { parsed = JSON.parse(kase.last_result) } catch {}

                return (
                  <div key={`exp-${kase.id}`} className="bg-slate-900/40 border border-slate-900 rounded-xl p-5 space-y-4 animate-fadeIn">
                    <div className="flex items-center justify-between border-b border-slate-950/40 pb-2">
                      <div className="flex items-center space-x-3 rtl:space-x-reverse">
                        <span className="text-xs font-bold text-slate-400">
                          {language === 'en' ? 'Evaluation Result Details' : 'تفاصيل نتيجة التقييم'} (ID: {kase.id})
                        </span>
                        <button
                          onClick={() => handleReRunSingleCase(kase.id)}
                          disabled={evalRunning || reRunningCaseId !== null || !documents.some(doc => doc.status === 'ready')}
                          className="bg-slate-950 hover:bg-slate-900 hover:text-brand-300 text-[10px] text-brand-400 font-bold px-2 py-0.5 rounded border border-slate-800 flex items-center space-x-1 rtl:space-x-reverse disabled:opacity-40 disabled:pointer-events-none transition-colors"
                          title="Run evaluation for this case"
                        >
                          {reRunningCaseId === kase.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          <span>{language === 'en' ? 'Re-run Case' : 'إعادة التقييم'}</span>
                        </button>
                      </div>
                      <button 
                        onClick={() => setExpandedCaseResult(prev => ({ ...prev, [kase.id]: false }))}
                        className="text-slate-500 hover:text-white text-xs"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="space-y-1">
                        <p className="text-slate-500 uppercase tracking-wider text-[10px]">{t.caseQuestion}</p>
                        <p className="text-slate-200 leading-normal font-medium">{kase.question}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-slate-500 uppercase tracking-wider text-[10px]">{t.caseExpected}</p>
                        <p className="text-slate-350 leading-normal">{kase.expected_answer}</p>
                      </div>
                    </div>

                    <div className="space-y-1 bg-slate-950/40 p-3 rounded-lg border border-slate-900/60 text-xs">
                      <p className="text-slate-500 uppercase tracking-wider text-[10px]">{t.caseGenerated}</p>
                      <p className="text-slate-300 leading-relaxed font-mono whitespace-pre-wrap">{parsed.answer || '-'}</p>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <p className="text-slate-500 uppercase tracking-wider text-[10px]">{t.caseReason}</p>
                      <p className="text-slate-400 bg-slate-950/20 border border-slate-900/20 p-3 rounded-lg leading-relaxed italic">
                        "{parsed.reason || '-'}"
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Right Column: Runs History List */}
            <div className="lg:col-span-4 space-y-4">
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider">{t.pastRuns}</h3>
              
              {evalRuns.length === 0 ? (
                <div className="bg-slate-900/10 border border-slate-900 rounded-xl p-8 text-center text-xs text-slate-500">
                  {t.noEvals}
                </div>
              ) : (
                <div className="space-y-3">
                  {evalRuns.map((run) => (
                    <div key={run.id} className="bg-slate-900/20 border border-slate-900 rounded-xl p-4 space-y-3 hover:bg-slate-900/35 transition-colors">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-slate-500 select-all">RUN: {run.id.substring(0, 8)}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(run.created_at * 1000).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-slate-950/30 border border-slate-900 rounded p-1.5">
                          <p className="text-[9px] text-slate-500 uppercase tracking-wide">Accuracy</p>
                          <p className="font-bold text-slate-200 mt-0.5">{run.total > 0 ? Math.round((run.correct / run.total) * 100) : 0}%</p>
                        </div>
                        <div className="bg-slate-950/30 border border-slate-900 rounded p-1.5">
                          <p className="text-[9px] text-slate-500 uppercase tracking-wide">Faithful</p>
                          <p className="font-bold text-slate-200 mt-0.5">{Math.round(run.faithfulness_score)}</p>
                        </div>
                        <div className="bg-slate-950/30 border border-slate-900 rounded p-1.5">
                          <p className="text-[9px] text-slate-500 uppercase tracking-wide">Cases</p>
                          <p className="font-bold text-slate-300 mt-0.5">{run.correct}/{run.total}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Edit Case Modal Dialog */}
          {editingCase && (
            <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-850 w-full max-w-xl rounded-2xl shadow-xl overflow-hidden p-6 animate-scaleIn">
                <div className="flex justify-between items-center border-b border-slate-950/40 pb-3">
                  <h3 className="font-bold text-sm text-slate-200 flex items-center">
                    <Edit3 className="w-4 h-4 text-brand-400 mr-2 ml-2" />
                    {t.editCase} ({editingCase.id})
                  </h3>
                  <button 
                    onClick={() => setEditingCase(null)}
                    className="text-slate-500 hover:text-white text-sm"
                  >
                    ✕
                  </button>
                </div>
                
                <form onSubmit={handleSaveCaseEdit} className="space-y-4 mt-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="text-slate-400 block font-semibold">{t.caseQuestion}</label>
                    <textarea
                      rows={3}
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-900 rounded-xl p-3 focus:outline-none focus:border-brand-500 text-slate-200"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-400 block font-semibold">{t.caseExpected}</label>
                    <textarea
                      rows={4}
                      value={editExpectedAnswer}
                      onChange={(e) => setEditExpectedAnswer(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-900 rounded-xl p-3 focus:outline-none focus:border-brand-500 text-slate-200"
                      required
                    />
                  </div>

                  <div className="flex justify-end space-x-3 rtl:space-x-reverse pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingCase(null)}
                      className="px-4 py-2 border border-slate-850 rounded-xl hover:bg-slate-900 transition-colors text-slate-400 hover:text-white font-medium"
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-medium transition-colors"
                    >
                      {t.saveChanges}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
