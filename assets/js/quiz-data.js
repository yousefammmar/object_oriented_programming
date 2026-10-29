/**
 * quiz-data.js — questions for the optional end-of-topic quizzes (rendered by quiz.js).
 *
 * Loaded only on the ten topic pages. Keys are topic ids from config.js.
 *   version  – bump when a topic's questions, options or answers change. Every research attempt stores
 *              the version it was taken with, and the export script only re-scores attempts whose
 *              version matches, so old and new question sets are never mixed up.
 *   q / code – question text and an optional C++ snippet (plain text, shown in a code block)
 *   options  – exactly four, shown in this order to everyone (a fixed instrument: no shuffling)
 *   answer   – index of the one correct option
 *   why      – explanation shown after the quiz is submitted
 *
 * Every code snippet was compiled with clang++ -std=c++11 to confirm the keyed answer. Snippets leave
 * out #include lines and using namespace std; as the course examples do.
 * Note: this file is public, so the answers are visible to anyone who opens it (docs/RESEARCH.md §8).
 */
(function (global) {
  'use strict';

  const OOP = (global.OOP = global.OOP || {});

  OOP.quizData = {
    cpp: {
      title: 'C++ Revision',
      version: 1,
      questions: [
        {
          q: 'What does this code print?',
          code: 'int a = 7, b = 2;\ncout << a / b;',
          options: ['3.5', '4', '3', '3.0'],
          answer: 2,
          why: 'Both operands are int, so / performs integer division and drops the fractional part: 7 / 2 is 3.'
        },
        {
          q: 'Which loop always runs its body at least once, even if its condition is false from the start?',
          options: ['do-while', 'while', 'for', 'Every loop does'],
          answer: 0,
          why: 'A do-while loop checks its condition after the body, so the body runs once before the first check. while and for check first and may run zero times.'
        },
        {
          q: 'What does this program print?',
          code: 'void addOne(int n)     { n++; }\nvoid addOneRef(int& n) { n++; }\n\nint main() {\n    int a = 5;\n    addOne(a);\n    addOneRef(a);\n    cout << a;\n}',
          options: ['5', '6', '7', 'Compilation error'],
          answer: 1,
          why: 'addOne receives a copy, so a stays 5; addOneRef receives a reference to a itself, so a becomes 6.'
        },
        {
          q: 'What does this code print?',
          code: 'int x = 10;\nint* ptr = &x;\n*ptr = 20;\ncout << x;',
          options: ['10', 'The address of x', 'Compilation error', '20'],
          answer: 3,
          why: 'ptr holds the address of x, so *ptr = 20 writes through the pointer into x itself.'
        },
        {
          q: 'What does this code print?',
          code: 'int arr[5] = {10, 20, 30, 40, 50};\nint* p = arr;\ncout << *(p + 2);',
          options: ['12', '20', '30', '40'],
          answer: 2,
          why: 'p points to arr[0], so p + 2 points to arr[2] and * reads its value, 30. (*p + 2, without the brackets, would give 12.)'
        },
        {
          q: 'What does this code print?',
          code: 'int m[3][3] = {{1, 2, 3},\n               {4, 5, 6},\n               {7, 8, 9}};\ncout << m[2][1];',
          options: ['4', '5', '6', '8'],
          answer: 3,
          why: 'The first index is the row and the second is the column, both starting at 0: row 2 is {7, 8, 9}, and column 1 of it is 8.'
        },
        {
          q: 'What does this code print?',
          code: 'string name = "PSUT";\ncout << name.length() << " " << name.substr(0, 2);',
          options: ['4 PS', '5 PS', '4 PSU', '3 PS'],
          answer: 0,
          why: 'length() counts the 4 characters. substr(0, 2) starts at index 0 and takes 2 characters, giving "PS".'
        },
        {
          q: 'Which statement correctly frees the memory allocated here?',
          code: 'int* da = new int[5];',
          options: ['delete da;', 'delete[] da;', 'delete da[5];', 'da = nullptr;'],
          answer: 1,
          why: 'Memory allocated with new[] must be freed with delete[]. Setting the pointer to nullptr without deleting just leaks the array.'
        }
      ]
    },
    classes: {
      title: 'Class Basics',
      version: 1,
      questions: [
        {
          q: 'If no access specifier is written, what access do the members of a class have?',
          options: ['public', 'private', 'protected', 'public for functions, private for data'],
          answer: 1,
          why: 'Members of a class are private by default; you must write public: to make them accessible from outside the class.'
        },
        {
          q: 'Which marked line causes a compilation error?',
          code: 'class BankAccount {\nprivate:\n    double balance_;\npublic:\n    BankAccount(double b) : balance_(b) {}\n    double getBalance() const { return balance_; }\n};\nint main() {\n    BankAccount acc(100.0);   // Line A\n    acc.getBalance();         // Line B\n    acc.balance_ = 0;         // Line C\n}',
          options: ['Line A', 'Line B', 'Line C', 'No line; it compiles'],
          answer: 2,
          why: 'balance_ is private, so main() cannot access it directly. It can only be read through the public getter.'
        },
        {
          q: 'What does this code print?',
          code: 'class Student {\nprivate:\n    double gpa_ = 90;\npublic:\n    void setGpa(double g) { if (g >= 0 && g <= 100) gpa_ = g; }\n    double getGpa() const { return gpa_; }\n};\n\n// in main():\nStudent s;\ns.setGpa(-10);\ncout << s.getGpa();',
          options: ['90', '-10', '0', 'Compilation error'],
          answer: 0,
          why: 'The setter validates its input: -10 is outside the range 0 to 100, so it is rejected and gpa_ keeps its value of 90.'
        },
        {
          q: 'What happens when this program is compiled?',
          code: 'class Point {\n    int x_, y_;\npublic:\n    Point(int x, int y) : x_(x), y_(y) {}\n};\n\nint main() {\n    Point p;\n}',
          options: ['p gets x_ = 0 and y_ = 0', 'p gets garbage values for x_ and y_', 'The compiler calls Point(0, 0) for you', 'Compilation error: Point has no default constructor'],
          answer: 3,
          why: 'Once a class declares any constructor, the compiler no longer generates a default constructor, so Point p; has no matching constructor.'
        },
        {
          q: 'Which constructor correctly uses an initialiser list?',
          options: ['Student(int id, string n) : id_(id), name_(n) {}', 'Student(int id, string n) { : id_(id), name_(n) }', 'Student(int id, string n) : id_ = id, name_ = n {}', 'Student(int id, string n) : {id_(id), name_(n)}'],
          answer: 0,
          why: 'The initialiser list goes after a colon, between the parameter list and the body, with each member written as member(value).'
        },
        {
          q: 'Which special member function does the second line call?',
          code: 'Student s1(1, "Sara", 95.0);\nStudent s2 = s1;',
          options: ['The default constructor', 'The parameterised constructor', 'The copy assignment operator', 'The copy constructor'],
          answer: 3,
          why: 's2 is being created from s1 in its declaration, so this is initialisation and calls the copy constructor. operator= is only used when assigning to an object that already exists.'
        },
        {
          q: 'What does this program print?',
          code: 'class FileHandler {\npublic:\n    FileHandler()  { cout << "Open "; }\n    ~FileHandler() { cout << "Close "; }\n};\nint main() {\n    {\n        FileHandler f;\n        cout << "Write ";\n    }\n    cout << "End";\n}',
          options: ['Open Write End Close', 'Open Close Write End', 'Open Write Close End', 'Open Write End'],
          answer: 2,
          why: 'f is a local object of the inner block, so its destructor runs automatically when that block ends, before "End" is printed.'
        },
        {
          q: 'Student.h declares int getId() const; inside class Student. Which line correctly defines it in Student.cpp?',
          options: ['int getId() const { return id_; }', 'int Student::getId() const { return id_; }', 'Student::int getId() const { return id_; }', 'int Student.getId() const { return id_; }'],
          answer: 1,
          why: 'Outside the class, the function name must be qualified with the class name and the scope operator (Student::), and the const must be repeated.'
        }
      ]
    },
    const: {
      title: 'Const & Static',
      version: 1,
      questions: [
        {
          q: 'Why does this class fail to compile?',
          code: 'class Student {\n    const int id_;\npublic:\n    Student(int id) { id_ = id; }\n};',
          options: ['The constructor must also be declared const', 'const members must be public', 'id_ must be initialised in the initialiser list, not assigned in the body', 'const members must also be declared static'],
          answer: 2,
          why: 'A const member cannot be assigned once it exists, and it already exists when the constructor body runs. It must get its value in the initialiser list: Student(int id) : id_(id) {}.'
        },
        {
          q: 'In the declaration double area() const; what does the const after the parameter list mean?',
          options: ['area() returns a const value', 'area() cannot modify the object\'s member variables', 'area() can only be called on const objects', 'area() cannot change its parameters'],
          answer: 1,
          why: 'A const member function promises not to change the object it is called on. It can be called on both const and non-const objects.'
        },
        {
          q: 'Which of the marked lines cause a compilation error?',
          code: 'class Circle {\n    double r_;\npublic:\n    Circle(double r) : r_(r) {}\n    double area() const { return 3.14 * r_ * r_; }\n    double getR() { return r_; }\n};\nint main() {\n    const Circle c(2.0);\n    c.getR();    // Line A\n    c.area();    // Line B\n}',
          options: ['Line A only', 'Line B only', 'Both lines', 'Neither line'],
          answer: 0,
          why: 'A const object can only call const member functions. getR() is not marked const (even though it changes nothing), so calling it on c is an error.'
        },
        {
          q: 'Which marked line causes a compilation error?',
          code: 'class Account {\n    double balance_ = 0;\npublic:\n    double getBalance() const { return balance_; }    // Line A\n    void deposit(double a) { balance_ += a; }         // Line B\n    void withdraw(double a) const { balance_ -= a; }  // Line C\n};',
          options: ['Line A', 'Line B', 'Line C', 'No line; it compiles'],
          answer: 2,
          why: 'withdraw() is declared const, so it is not allowed to modify balance_. The const getter only reads it, and the non-const deposit() may change it.'
        },
        {
          q: 'What does this code print?',
          code: 'class Student {\n    static int count_;\npublic:\n    Student()  { count_++; }\n    ~Student() { count_--; }\n    static int getCount() { return count_; }\n};\nint Student::count_ = 0;\n// in main():\ncout << Student::getCount() << " ";\n{ Student a, b; cout << Student::getCount() << " "; }\ncout << Student::getCount();',
          options: ['0 2 2', '0 1 0', 'Compilation error', '0 2 0'],
          answer: 3,
          why: 'count_ is a single variable shared by all Student objects, and it exists before any object is created. It rises to 2 when a and b are built, then drops back to 0 when their destructors run at the end of the block.'
        },
        {
          q: 'A class declares static int count_; and uses it, but int Student::count_ = 0; is never written outside the class. What happens?',
          options: ['count_ starts at 0 automatically', 'Each object gets its own count_ instead', 'It compiles, but count_ holds a garbage value', 'The build fails: count_ is declared but never defined'],
          answer: 3,
          why: 'The line inside the class only declares the static member. It must be defined once outside the class, otherwise the linker reports an undefined reference.'
        },
        {
          q: 'Which marked line causes a compilation error?',
          code: 'class Counter {\n    int value_ = 0;\n    static int total_;\npublic:\n    static int getTotal() { return total_; }   // Line A\n    static int getValue() { return value_; }   // Line B\n    int getSum() { return value_ + total_; }   // Line C\n};\nint Counter::total_ = 0;',
          options: ['Line A', 'Line B', 'Line C', 'No line; it compiles'],
          answer: 1,
          why: 'A static member function has no this pointer, so it cannot use the non-static member value_. A normal member function such as getSum() may use both kinds of members.'
        },
        {
          q: 'No Student objects exist yet. How do you call the static member function getCount() of class Student from main()?',
          options: ['Student::getCount()', 'Student.getCount()', 'Student->getCount()', 'You cannot; an object must exist first'],
          answer: 0,
          why: 'A static member function belongs to the class itself, so it is called with the scope operator, ClassName::method(), and works even when no objects exist.'
        }
      ]
    },
    composition: {
      title: 'Composition',
      version: 1,
      questions: [
        {
          q: 'What kind of relationship does composition model?',
          options: ['"has-a": a Person has a Date as a member', '"is-a": a Person is a kind of Date', '"friend": Person can read Date\'s private data', '"static": all Person objects share one Date'],
          answer: 0,
          why: 'Composition means a class contains an object of another class as a data member, such as a Person that has a Date of birth.'
        },
        {
          q: 'What does this program print?',
          code: 'class Date {\npublic:\n    Date() { cout << "Date "; }\n};\nclass Person {\n    Date dob_;\npublic:\n    Person() { cout << "Person "; }\n};\nint main() {\n    Person p;\n}',
          options: ['Person Date', 'Date Person', 'Person', 'Date'],
          answer: 1,
          why: 'Member objects are constructed before the body of the containing class\'s constructor runs, so Date\'s constructor prints first.'
        },
        {
          q: 'Why does this code fail to compile?',
          code: 'class Date {\n    int d_, m_, y_;\npublic:\n    Date(int d, int m, int y) : d_(d), m_(m), y_(y) {}\n};\nclass Person {\n    Date dob_;\npublic:\n    Person(int d, int m, int y) {\n        dob_ = Date(d, m, y);\n    }\n};',
          options: ['A class cannot contain an object of another class', 'Date objects cannot be assigned with =', 'Date has no default constructor, so dob_ must be built in the initialiser list', 'Person needs a destructor because it contains a Date'],
          answer: 2,
          why: 'dob_ is constructed before the body runs; with nothing in the initialiser list the compiler needs Date(), which does not exist. Writing : dob_(d, m, y) in the initialiser list fixes it.'
        },
        {
          q: 'Person has members string name_ and Date birthDate_. Which constructor correctly initialises both?',
          options: ['Person(string n, Date d) : name_(n) { Date birthDate_ = d; }', 'Person(string n, Date d) : name_(n), Date(d) {}', 'Person(string n, Date d) : name_ = n, birthDate_ = d {}', 'Person(string n, Date d) : name_(n), birthDate_(d) {}'],
          answer: 3,
          why: 'Member objects are initialised in the initialiser list just like other members, as member(value). The first option only creates a local Date that hides the member.'
        },
        {
          q: 'What happens when this code is compiled?',
          code: 'class Date {\n    int year_;\npublic:\n    Date(int y) : year_(y) {}\n    int getYear() const { return year_; }\n};\nclass Person {\n    Date dob_;\npublic:\n    Person(int y) : dob_(y) {}\n    int getAge() const { return 2025 - dob_.year_; }\n};',
          options: ['It compiles: Person contains dob_, so it can read dob_.year_', 'Compilation error: year_ is private to Date; use dob_.getYear()', 'It compiles, but getAge() returns a garbage value', 'Compilation error: getAge() cannot be const'],
          answer: 1,
          why: 'Containing a Date does not give Person access to Date\'s private members. Person must use Date\'s public interface, for example dob_.getYear().'
        },
        {
          q: 'When the body of Person\'s constructor starts running, what is true about its Date member birthDate_?',
          options: ['It has already been constructed', 'It will be constructed after the body finishes', 'It stays uninitialised until it is assigned in the body', 'It is constructed the first time it is used'],
          answer: 0,
          why: 'Member objects are constructed first, before the constructor body runs, either from the initialiser list or with their default constructor.'
        },
        {
          q: 'What does this code print?',
          code: 'class Date {\npublic:\n    int y_;\n    Date() : y_(2025) {}\n    Date(int y) : y_(y) {}\n};\nclass Person {\npublic:\n    Date dob_;\n    Person() {}\n};\n// in main(): Person p; cout << p.dob_.y_;',
          options: ['A garbage value', '0', 'Compilation error: dob_ is never initialised', '2025'],
          answer: 3,
          why: 'dob_ is not in Person\'s initialiser list, so it is built with Date\'s default constructor before Person\'s body runs, which sets y_ to 2025.'
        },
        {
          q: 'Which design is an example of composition?',
          options: ['A SportsCar class that inherits from Car', 'A function that takes a Car as a parameter', 'A Car class with an Engine data member', 'A Car class with a static count of cars'],
          answer: 2,
          why: 'An Engine data member means a Car has an Engine, which is composition. Inheriting from Car is an "is-a" relationship instead.'
        }
      ]
    },
    dma: {
      title: 'Dynamic Memory',
      version: 1,
      questions: [
        {
          q: 'A Student constructor allocates grades = new int[size];. What should the destructor contain?',
          options: ['delete grades;', 'grades = nullptr;', 'delete[] grades;', 'Nothing; the memory is freed automatically'],
          answer: 2,
          why: 'Heap memory is not freed automatically, and memory from new[] must be released with delete[]. Without it every Student object leaks its array.'
        },
        {
          q: 'What is wrong with this code?',
          code: 'int* p = new int[10];\np = new int[10];\ndelete[] p;',
          options: ['Nothing; both arrays are freed', 'Double delete: the same array is freed twice', 'Compilation error: p is assigned twice', 'The first array leaks: nothing points to it anymore'],
          answer: 3,
          why: 'The second new overwrites the only pointer to the first array, so that array can never be deleted. delete[] p frees only the second one.'
        },
        {
          q: 'Which line correctly calls the member function print() through p?',
          code: 'Student* p = new Student();',
          options: ['p.print();', 'p->print();', '*p.print();', 'p::print();'],
          answer: 1,
          why: 'p is a pointer, so members are reached with the arrow operator, p->print() (or (*p).print()). *p.print() fails because the dot binds before the *.'
        },
        {
          q: 'What happens at the last line?',
          code: 'int* p = new int(5);\ndelete p;\np = nullptr;\ndelete p;',
          options: ['Nothing; deleting a nullptr is safe', 'A crash, because p was already deleted', 'A compilation error', 'The int is freed a second time'],
          answer: 0,
          why: 'Deleting a nullptr does nothing. That is why setting a pointer to nullptr right after delete protects against an accidental double delete.'
        },
        {
          q: 'What goes wrong when this program runs?',
          code: 'class Student {\n    int* grades;\npublic:\n    Student(int n) { grades = new int[n]; }\n    ~Student() { delete[] grades; }\n};\nint main() {\n    Student s1(3);\n    Student s2 = s1;\n}',
          options: ['Nothing; s2 gets its own copy of the array', 'Compilation error: Student has no copy constructor', 'Both share one array, so it is deleted twice at the end', 'The array leaks because no destructor runs'],
          answer: 2,
          why: 'The default copy constructor makes a shallow copy: s2.grades holds the same address as s1.grades. When both destructors run, the same array is deleted twice.'
        },
        {
          q: 'What must a deep-copy constructor do for a class with a dynamic array member?',
          options: ['Copy the pointer so both objects share the array', 'Allocate a new array and copy each value into it', 'Delete the other object\'s array, then take its pointer', 'Set the pointer to nullptr so nothing is shared'],
          answer: 1,
          why: 'A deep copy gives the new object its own memory holding the same values, so each object can later delete its own array safely.'
        },
        {
          q: 'This code grows the dynamic array grades by one element. Which line correctly finishes it?',
          code: 'int* temp = new int[size + 1];\nfor (int i = 0; i < size; i++)\n    temp[i] = grades[i];\n// missing line',
          options: ['grades = temp; delete[] grades; size++;', 'delete[] temp; grades = temp; size++;', 'delete grades; grades = temp; size++;', 'delete[] grades; grades = temp; size++;'],
          answer: 3,
          why: 'After copying, free the old array with delete[], then point grades at the new array and update the size. Deleting after reassigning would free the new array instead.'
        },
        {
          q: 'What does this program print?',
          code: 'class A {\npublic:\n    ~A() { cout << "bye "; }\n};\nint main() {\n    A a;\n    A* p = new A();\n    cout << "end ";\n}',
          options: ['end bye', 'end bye bye', 'bye end bye', 'end'],
          answer: 0,
          why: 'a is on the stack, so its destructor runs when main() ends. The heap object is never deleted, so its destructor never runs (and its memory leaks).'
        }
      ]
    },
    this: {
      title: 'this Pointer',
      version: 1,
      questions: [
        {
          q: 'Inside a non-static member function, what does this point to?',
          options: ['The class definition itself', 'The object that called the function', 'The first data member of the class', 'The most recently created object of the class'],
          answer: 1,
          why: 'this is a pointer to the calling object. It is passed automatically to every non-static member function.'
        },
        {
          q: 'What does this program print?',
          code: 'class Student {\n  int grade = 0;\npublic:\n  void setGrade(int grade) { grade = grade; }\n  int getGrade() const { return grade; }\n};\n// in main:\nStudent s;\ns.setGrade(90);\ncout << s.getGrade();',
          options: ['0', '90', 'A compile error: grade is ambiguous', 'A garbage value'],
          answer: 0,
          why: 'Inside setGrade, the name grade refers to the parameter, so grade = grade assigns the parameter to itself. The data member keeps its initial value 0.'
        },
        {
          q: 'In void setGrade(int grade), which statement stores the parameter in the data member named grade?',
          options: ['this.grade = grade;', 'grade = this->grade;', '*this.grade = grade;', 'this->grade = grade;'],
          answer: 3,
          why: 'this is a pointer, so the member is reached with this->grade (or (*this).grade). The plain name grade refers to the parameter.'
        },
        {
          q: 'Which line causes a compile error?',
          code: 'class Counter {\n  int n = 0;\npublic:\n  void inc() { this->n++; }               // Line A\n  int get() const { return this->n; }     // Line B\n  static void reset() { this->n = 0; }    // Line C\n  Counter& self() { return *this; }       // Line D\n};',
          options: ['Line A', 'Line B', 'Line C', 'Line D'],
          answer: 2,
          why: 'A static member function belongs to the class, not to an object, so it has no this pointer. The const function in Line B still has this; it just cannot modify members.'
        },
        {
          q: 'What does this program print?',
          code: 'class Student {\n  string name; int grade = 0;\npublic:\n  Student setName(string n) { name = n; return *this; }\n  Student setGrade(int g) { grade = g; return *this; }\n  int getGrade() const { return grade; }\n};\n// in main:\nStudent s;\ns.setGrade(70);\ns.setName("Sara").setGrade(95);\ncout << s.getGrade();',
          options: ['95', '0', '70', 'A compile error: calls cannot be chained'],
          answer: 2,
          why: 'setName returns a copy of s, so setGrade(95) changes that temporary copy, not s. For cascading to work, the setters must return Student& (a reference to *this).'
        },
        {
          q: 'A member function is declared Student& test() and ends with return *this;. What does it return?',
          options: ['A reference to the calling object', 'A new copy of the calling object', 'The address of the calling object', 'A default-constructed Student'],
          answer: 0,
          why: '*this is the calling object itself (this is its address), and the Student& return type returns it by reference, without copying.'
        },
        {
          q: 'Which statement about const and static member functions is correct?',
          options: ['Both have a this pointer, but a static one cannot change members', 'Neither has a this pointer', 'A static function has a this pointer to a const object', 'A const function has a this pointer; a static function has none'],
          answer: 3,
          why: 'A const function works on a specific object (this points to a const object, so members cannot be changed). A static function belongs to the class and has no this, which is why a function cannot be both.'
        },
        {
          q: 'What does the constructor Student(int grade) : grade(grade) { } do?',
          options: ['Assigns the parameter to itself; the member is untouched', 'Initialises the data member grade with the parameter grade', 'Initialises the parameter grade with the data member grade', 'Causes a compile error because the names clash'],
          answer: 1,
          why: 'In an initialiser list, the name outside the parentheses is the data member being initialised, and the name inside refers to the parameter. This avoids shadowing without needing this->.'
        }
      ]
    },
    friend: {
      title: 'Friend Functions',
      version: 1,
      questions: [
        {
          q: 'Which statement about a friend function of a class is correct?',
          options: ['It is a member function declared with the friend keyword', 'It is not a member, but it can access private and protected members', 'It can access only the public members of the class', 'It must be defined inside the class body'],
          answer: 1,
          why: 'A friend is declared inside the class with friend but is not a member of it. It may read private and protected members, and is usually defined outside like a normal function.'
        },
        {
          q: 'Given this class, which call to printGrade is correct?',
          code: 'class Student {\n  int grade = 90;\n  friend void printGrade(const Student& s);\n};\nvoid printGrade(const Student& s) { cout << s.grade; }\n// in main:\nStudent s1;',
          options: ['s1.printGrade();', 'Student::printGrade(s1);', 's1.printGrade(s1);', 'printGrade(s1);'],
          answer: 3,
          why: 'A friend function is not a member, so it is not called on an object. It is called like a normal function, with the object passed as an argument.'
        },
        {
          q: 'Can a friend function use the this pointer?',
          options: ['Yes, this points to the object passed as an argument', 'Yes, but only to read private members', 'No, because it is not a member, so no object calls it', 'No, because friend functions must be declared static'],
          answer: 2,
          why: 'this exists only in non-static member functions, where it points to the calling object. A friend function is not a member and is not called on an object, so it has no this.'
        },
        {
          q: 'Which line causes a compile error?',
          code: 'class Box {\n  int w = 5;\n  friend void show(const Box& b);\n};\nvoid show(const Box& b) { cout << b.w; }   // Line A\nvoid peek(const Box& b) { cout << b.w; }   // Line B\nint main() {\n  Box b;\n  show(b);                                  // Line C\n  peek(b);                                  // Line D\n}',
          options: ['Line A', 'Line B', 'Line C', 'Line D'],
          answer: 1,
          why: 'w is private. show is declared a friend of Box, so it may read b.w, but peek is not a friend, so b.w is inaccessible inside it.'
        },
        {
          q: 'Class A contains the declaration friend class B;. Which statement is true?',
          options: ['Member functions of B can access private members of A', 'Member functions of A can access private members of B', 'A and B can each access the other\'s private members', 'Classes derived from B can also access private members of A'],
          answer: 0,
          why: 'friend class B; makes every member function of B a friend of A. Friendship is one-way and is not inherited, so A gets no access to B, and classes derived from B get none to A.'
        },
        {
          q: 'What is the purpose of the first line, class ClassB; ?',
          code: 'class ClassB;\nclass ClassA {\n  int a = 1;\n  friend void showSum(const ClassA& x, const ClassB& y);\n};\nclass ClassB {\n  int b = 2;\n  friend void showSum(const ClassA& x, const ClassB& y);\n};\nvoid showSum(const ClassA& x, const ClassB& y) { cout << x.a + y.b; }',
          options: ['It makes ClassB a friend of ClassA', 'It makes showSum a member of ClassB', 'It lets ClassA mention ClassB before ClassB is defined', 'It is needed so main can create ClassB objects'],
          answer: 2,
          why: 'It is a forward declaration. The friend declaration inside ClassA names ClassB, so the compiler must already know ClassB is a class before its full definition appears.'
        },
        {
          q: 'Does it matter whether a friend declaration is placed in the public or the private part of a class?',
          options: ['No, it means the same thing in either part', 'Yes, it must be in the public part to work', 'Yes, a friend declared in the private part can only read members', 'Yes, a friend declared in the private part can only be called by members'],
          answer: 0,
          why: 'Access specifiers do not apply to friend declarations. Wherever it appears in the class, the function gets the same access.'
        },
        {
          q: 'Which is a good reason to make a function a friend?',
          options: ['To avoid writing getters for a class', 'To make the function run faster than a member', 'To let a derived class reach its base class\'s private members', 'The function needs private data from two different classes'],
          answer: 3,
          why: 'Every friend weakens encapsulation, so member functions and getters come first. A friend is justified when one function needs private data from two classes, or for operators like << whose left operand is not your class.'
        }
      ]
    },
    inheritance: {
      title: 'Inheritance',
      version: 1,
      questions: [
        {
          q: 'Which relationship is best modelled with inheritance?',
          options: ['A Car has an Engine', 'A Student is a Person', 'A Library has many Books', 'A Team has a Coach'],
          answer: 1,
          why: 'Inheritance models IS-A: every Student is also a Person. HAS-A relationships, like a Car having an Engine, are modelled with composition.'
        },
        {
          q: 'Student inherits publicly from Person. Which Person members can the member functions of Student access directly?',
          options: ['Public and protected members', 'Only public members', 'Public, protected and private members', 'Only protected members'],
          answer: 0,
          why: 'Protected members are available to the class and its derived classes, and public members to everyone. Private base members are never directly accessible in a derived class; use public or protected getters and setters.'
        },
        {
          q: 'What does this program print?',
          code: 'class A {\npublic:\n  A()  { cout << "A "; }\n  ~A() { cout << "~A "; }\n};\nclass B : public A {\npublic:\n  B()  { cout << "B "; }\n  ~B() { cout << "~B "; }\n};\nint main() { B b; }',
          options: ['B A ~B ~A', 'A B ~A ~B', 'A B ~B ~A', 'B ~B'],
          answer: 2,
          why: 'Constructors run base to derived, so A then B. Destructors run in the reverse order, so ~B then ~A.'
        },
        {
          q: 'What happens when this code is compiled?',
          code: 'class Person {\n  string name;\npublic:\n  Person(string n) : name(n) { }\n};\nclass Student : public Person {\npublic:\n  Student() { }\n};',
          options: ['It compiles; name is an empty string', 'Compile error: Person has no default constructor', 'It compiles; name is left uninitialised', 'Compile error: name is private in Person'],
          answer: 1,
          why: 'Student() does not call a Person constructor, so the compiler tries Person(), which does not exist. Fix it by calling the base constructor in the initialiser list: Student() : Person("Ali") { }.'
        },
        {
          q: 'What does this program print?',
          code: 'class Person {\npublic:\n  void print() { cout << "Person "; }\n};\nclass Student : public Person {\npublic:\n  void print() { Person::print(); cout << "Student"; }\n};\nint main() {\n  Student s;\n  s.print();\n}',
          options: ['Student', 'Person', 'Student Person', 'Person Student'],
          answer: 3,
          why: 's.print() calls Student::print, which overrides the base version. It first calls the base version with Person::print() and then prints Student.'
        },
        {
          q: 'What happens when this code is compiled?',
          code: 'class Person  { public: void print() { cout << "P"; } };\nclass Citizen { public: void print() { cout << "C"; } };\nclass Student : public Person, public Citizen { };\nint main() {\n  Student s;\n  s.print();\n}',
          options: ['It prints P, because Person is listed first', 'It prints PC', 'Compile error: the call to print is ambiguous', 'It prints C, because Citizen is listed last'],
          answer: 2,
          why: 'Student inherits a print from both bases, so s.print() is ambiguous. Fix it with s.Person::print(), by overriding print in Student, or with a using declaration.'
        },
        {
          q: 'With class B : protected A { ... };, what do the public members of A become in B?',
          options: ['Public', 'Private', 'Inaccessible', 'Protected'],
          answer: 3,
          why: 'Protected inheritance makes the public and protected members of the base protected in the derived class. Public inheritance keeps them as they are; private inheritance makes both private.'
        },
        {
          q: 'By default, which of these does a derived class inherit from its base class?',
          options: ['Ordinary public member functions', 'Constructors', 'The destructor', 'Friend functions'],
          answer: 0,
          why: 'Constructors, the destructor, the assignment operator and friend functions are not inherited. Ordinary member functions are inherited and can be used as they are or overridden.'
        }
      ]
    },
    polymorphism: {
      title: 'Polymorphism',
      version: 1,
      questions: [
        {
          q: 'Circle inherits publicly from Shape. Given Shape sh; and Circle ci;, which line compiles?',
          options: ['Circle* p = &sh;', 'Shape* p = &ci;', 'Circle& r = sh;', 'Circle c = sh;'],
          answer: 1,
          why: 'A base-class pointer can point to a derived object, because every Circle is a Shape. The reverse is not allowed: a Shape is not necessarily a Circle.'
        },
        {
          q: 'What does this program print?',
          code: 'class Shape {\npublic:\n  void draw() { cout << "Drawing a shape"; }\n};\nclass Circle : public Shape {\npublic:\n  void draw() { cout << "Drawing a circle"; }\n};\nint main() {\n  Shape* s = new Circle();\n  s->draw();\n}',
          options: ['Drawing a shape', 'Drawing a circle', 'Drawing a shapeDrawing a circle', 'Compile error: draw must be virtual'],
          answer: 0,
          why: 'draw is not virtual, so the call is bound at compile time using the pointer type, Shape*. This is static binding.'
        },
        {
          q: 'What does this program print?',
          code: 'class Shape {\npublic:\n  virtual void draw() { cout << "S "; }\n};\nclass Circle : public Shape { public: void draw() override { cout << "C "; } };\nclass Square : public Shape { public: void draw() override { cout << "Q "; } };\n// in main:\nShape* shapes[2] = { new Circle(), new Square() };\nfor (int i = 0; i < 2; i++)\n  shapes[i]->draw();',
          options: ['S S', 'S C S Q', 'C Q', 'Compile error: the array mixes Circle and Square'],
          answer: 2,
          why: 'draw is virtual and is called through base-class pointers, so each call runs the version of the real object: Circle, then Square.'
        },
        {
          q: 'What does this program print?',
          code: 'class Animal {\npublic:\n  virtual void speak() { cout << "..."; }\n};\nclass Dog : public Animal {\npublic:\n  void speak() override { cout << "Woof"; }\n};\n// in main:\nDog d;\nAnimal a = d;\na.speak();',
          options: ['Woof', '...Woof', 'Compile error: cannot copy a Dog into an Animal', '...'],
          answer: 3,
          why: 'Animal a = d; copies only the Animal part of d (object slicing), and a call through an object name is bound at compile time. Polymorphism works only through pointers or references.'
        },
        {
          q: 'Which line in main causes a compile error?',
          code: 'class Shape {\npublic:\n  virtual void draw() = 0;\n};\nclass Circle : public Shape {\npublic: void draw() override { cout << "C"; }\n};\n// in main:\nCircle c;                  // Line A\nShape s;                   // Line B\nShape* p = new Circle();   // Line C\nShape& r = c;              // Line D',
          options: ['Line A', 'Line B', 'Line C', 'Line D'],
          answer: 1,
          why: 'Shape has a pure virtual function, so it is abstract and no Shape object can be created. Pointers and references to Shape are still allowed, and Circle is concrete because it implements draw.'
        },
        {
          q: 'Why should a base class that is used through pointers have a virtual destructor?',
          options: ['So delete through a base pointer also runs the derived destructor', 'So the base destructor runs before the derived one', 'So the base class becomes abstract', 'So objects of the class can only be created with new'],
          answer: 0,
          why: 'With a virtual destructor, delete on a base pointer runs the derived destructor first, then the base one. Without it, the derived destructor is skipped (formally undefined behaviour), so its resources can leak.'
        },
        {
          q: 'When is the function that runs chosen by the actual object type at runtime?',
          options: ['Whenever a pointer is used, virtual or not', 'Whenever the function is virtual, even through an object name', 'Only when the derived class writes override', 'When it is called through a pointer or reference and is virtual'],
          answer: 3,
          why: 'Dynamic binding needs both a call through a base pointer or reference and a virtual function. Otherwise the declared type decides at compile time.'
        },
        {
          q: 'What happens when this code is compiled?',
          code: 'class Base {\npublic:\n  virtual void show() const { cout << "Base"; }\n};\nclass Derived : public Base {\npublic:\n  void show() override { cout << "Derived"; }\n};',
          options: ['It compiles, and Derived::show overrides Base::show', 'It compiles, and show becomes const in Derived too', 'Compile error: show does not override, because const is missing', 'Compile error: override must also be written in Base'],
          answer: 2,
          why: 'The missing const gives a different signature, so Derived::show would be a new function, not an override. Because override is written, the compiler reports the mismatch.'
        }
      ]
    },
    operators: {
      title: 'Operator Overloading',
      version: 1,
      questions: [
        {
          q: 'Which of these is allowed when overloading operators?',
          options: ['Changing the precedence of + for your class', 'Creating a new operator such as **', 'Overloading + so that p1 + p2 works for Point objects', 'Redefining + for two int values'],
          answer: 2,
          why: 'Operator overloading redefines existing operators for your own classes. You cannot invent new operators, change precedence, or redefine an operator when no operand is a class type.'
        },
        {
          q: 'How does the compiler tell postfix operator++ apart from prefix operator++?',
          options: ['Postfix takes an extra, unused int parameter', 'Postfix is declared const', 'Postfix must be a friend function', 'Postfix returns a reference instead of a value'],
          answer: 0,
          why: 'Prefix is operator++() and postfix is operator++(int). The int is never used; it exists only to tell the two apart.'
        },
        {
          q: 'What does this program print?',
          code: 'class Point {\npublic:\n  int x, y;\n  Point(int a, int b) : x(a), y(b) { }\n  Point& operator++() { ++x; ++y; return *this; }\n  Point operator++(int) { Point t = *this; ++x; ++y; return t; }\n};\n// in main:\nPoint p(1, 1);\nPoint a = p++;\nPoint b = ++p;\ncout << a.x << " " << b.x << " " << p.x;',
          options: ['2 3 3', '1 2 3', '2 2 3', '1 3 3'],
          answer: 3,
          why: 'p++ returns the old value (a.x is 1) and makes p.x 2. ++p increments first and returns the updated object, so b.x and p.x are both 3.'
        },
        {
          q: 'Why is operator<< for a Point class usually written as a friend rather than a member?',
          options: ['Friend functions run faster than member functions', 'Its left operand, cout, is not a Point', 'A member operator cannot return ostream&', 'Its right operand must be passed by value'],
          answer: 1,
          why: 'A member operator needs an object of the class as its left operand. In cout << p the left operand is an ostream, so the operator must be a non-member, made a friend to read private data.'
        },
        {
          q: 'Point overloads operator+ as a member function. In the expression p1 + p2, which object is *this?',
          options: ['p2', 'p1', 'A temporary copy of p2', 'Neither, because operators have no this pointer'],
          answer: 1,
          why: 'p1 + p2 is called as p1.operator+(p2): the left operand is *this and the right operand is the parameter.'
        },
        {
          q: 'Why does Point& operator+=(const Point& p) end with return *this;?',
          options: ['To allow chaining without creating a temporary copy', 'Because += must be written as a friend function', 'Because operator functions cannot return void', 'So that the right operand p is also updated'],
          answer: 0,
          why: '+= changes the current object, then returns that same object by reference, so calls can be chained and no copy is made.'
        },
        {
          q: 'Which statement about lines A and B is correct?',
          code: 'class Point {\n  int x, y;\npublic:\n  Point(int a, int b) : x(a), y(b) { }\n  Point operator*(int k) const { return Point(x * k, y * k); }\n};\n// in main:\nPoint p(1, 2);\nPoint q = p * 2;   // Line A\nPoint r = 2 * p;   // Line B',
          options: ['Both lines compile', 'Line B compiles; line A is an error', 'Line A compiles; line B is an error', 'Both lines are errors'],
          answer: 2,
          why: 'A member operator is called on its left operand, so p * 2 works as p.operator*(2). In 2 * p the left operand is an int, so it needs a non-member (usually friend) operator*(int, const Point&).'
        },
        {
          q: 'In Point operator+(const Point& p) const, what does the const at the end guarantee?',
          options: ['The returned Point cannot be modified', 'The function can only be called on const objects', 'The function cannot read any data members', 'The current object (the left operand) is not modified'],
          answer: 3,
          why: 'A trailing const means the function promises not to modify the object it is called on. It can still read members and can be called on non-const objects.'
        }
      ]
    }
  };
})(window);
