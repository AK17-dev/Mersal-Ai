-- Migration 0003: replace placeholder eval cases with real cases
-- matched to mersal-test-english.pdf (remote work handbook, 2 pages)
-- and mersal-test-arabic-multipage.pdf (HR policy handbook, 3 pages).
-- Both documents must be uploaded and 'ready' in the session before running evals.

DELETE FROM eval_cases;

-- ===== English cases (mersal-test-english.pdf) =====
INSERT INTO eval_cases (id, question, expected_answer, language) VALUES
('ec-en-01', 'What is the minimum internet speed required for remote work?', 'A stable internet connection with a minimum upload and download speed of 25 Mbps is required. (Source: p.1)', 'en'),
('ec-en-02', 'What are the core hours remote employees must be available?', 'Core hours are 10 AM to 3 PM in the employee''s local time zone. (Source: p.1)', 'en'),
('ec-en-03', 'How long is the probationary period before an employee can request remote work?', 'Three months. Employees who have completed their three-month probationary period are eligible. (Source: p.1)', 'en'),
('ec-en-04', 'What equipment does the company provide for remote employees?', 'The company provides a laptop, monitor, and necessary software licenses. (Source: p.1)', 'en'),
('ec-en-05', 'How quickly must a suspected security incident be reported?', 'Within 24 hours, to the security team. (Source: p.1)', 'en'),
('ec-en-06', 'How much notice does the company give before modifying or ending a remote work arrangement?', '30 days written notice. (Source: p.2)', 'en'),
('ec-en-07', 'How often are remote work arrangements reviewed?', 'Every six months. (Source: p.2)', 'en'),
('ec-en-08', 'Within what timeframe should remote employees respond to direct messages?', 'Within a reasonable timeframe, typically within two hours during working hours. (Source: p.1)', 'en'),
('ec-en-09', 'Is it allowed to store confidential company data on personal devices?', 'No. Storing confidential company data on personal devices or unapproved cloud storage services is strictly prohibited. (Source: p.1)', 'en'),
('ec-en-10', 'What is the company''s policy on stock options for remote employees?', 'The documents do not contain any information about stock options, so the correct behavior is to state that no answer was found in the documents.', 'en');

-- ===== Arabic cases (mersal-test-arabic-multipage.pdf) =====
INSERT INTO eval_cases (id, question, expected_answer, language) VALUES
('ec-ar-01', 'كم يوماً تبلغ الإجازة السنوية للموظف؟', 'الإجازة السنوية مدفوعة الأجر مدتها 21 يوم عمل في السنة، وترتفع إلى 28 يوماً بعد إتمام خمس سنوات من الخدمة. (المصدر: ص1)', 'ar'),
('ec-ar-02', 'كم يوماً يمكن ترحيله من الإجازة السنوية إلى السنة التالية؟', 'لا يجوز ترحيل أكثر من 10 أيام، وتسقط الأيام الزائدة تلقائياً في نهاية شهر آذار. (المصدر: ص1)', 'ar'),
('ec-ar-03', 'قبل كم من الوقت يجب تقديم طلب الإجازة السنوية؟', 'قبل أسبوعين على الأقل من التاريخ المطلوب. (المصدر: ص1)', 'ar'),
('ec-ar-04', 'كم يوماً تبلغ الإجازة المرضية مدفوعة الأجر بالكامل؟', '15 يوماً في السنة كحد أقصى بأجر كامل، ثم 15 يوماً إضافية بنصف الأجر، ثم بدون أجر. (المصدر: ص2)', 'ar'),
('ec-ar-05', 'متى يشترط تقديم تقرير طبي للإجازة المرضية؟', 'إذا تجاوزت الإجازة المرضية ثلاثة أيام متتالية. (المصدر: ص2)', 'ar'),
('ec-ar-06', 'كم يوماً في الأسبوع يمكن للموظف العمل عن بعد؟', 'بحد أقصى ثلاثة أيام في الأسبوع بعد موافقة المدير، مع التواجد في المكتب أيام الاثنين والخميس. (المصدر: ص2)', 'ar'),
('ec-ar-07', 'ما هي قيمة بدل الإنترنت الشهري للعاملين عن بعد؟', '30 دولاراً أمريكياً شهرياً لجميع الموظفين المعتمدين للعمل عن بعد. (المصدر: ص2)', 'ar'),
('ec-ar-08', 'كم مرة يُجرى تقييم الأداء في السنة ومتى؟', 'مرتين في السنة، في شهري حزيران وكانون الأول. (المصدر: ص3)', 'ar'),
('ec-ar-09', 'ما هي ميزانية التدريب السنوية المخصصة لكل موظف؟', '800 دولار لكل موظف سنوياً، تُستخدم للدورات المهنية والشهادات المعتمدة والمؤتمرات التقنية. (المصدر: ص3)', 'ar'),
('ec-ar-10', 'ما هي سياسة الشركة بخصوص سيارات الموظفين؟', 'لا تحتوي المستندات على أي معلومات عن سيارات الموظفين، والسلوك الصحيح هو الإجابة بأنه لم يتم العثور على إجابة في المستندات.', 'ar');
