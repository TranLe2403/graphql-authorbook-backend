const { ApolloServer, UserInputError, gql, PubSub } = require("apollo-server");
const mongoose = require("mongoose");
const { v1: uuid } = require("uuid");
const Book = require("./models/book");
const Author = require("./models/author");
const User = require("./models/user");

const pubsub = new PubSub();

const jwt = require("jsonwebtoken");

const JWT_SECRET = "NEED_HERE_A_SECRET_KEY";

const MONGODB_URI = `mongodb+srv://phonebook:phonebook@cluster0.ud05y.mongodb.net/book-info?retryWrites=true&w=majority`;

console.log("connecting to", MONGODB_URI);

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useFindAndModify: false,
    useCreateIndex: true,
  })
  .then(() => {
    console.log("connected to MongoDB");
  })
  .catch((error) => {
    console.log("error connection to MongoDB:", error.message);
  });

const typeDefs = gql`
  type Subscription {
    bookAdded: Book!
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Author {
    name: String!
    id: ID!
    born: Int
    bookCount: Int
  }

  type Mutation {
    addBook(
      title: String!
      author: String
      published: Int!
      genres: [String!]!
    ): Book
    addAuthor(name: String!, born: Int): Author
    editAuthor(name: String!, setBornTo: Int!): Author
    createUser(username: String!, favoriteGenre: String!): User
    login(username: String!, password: String!): Token
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
    me: User
    favoriteBooks: [Book!]
  }
`;

const resolvers = {
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      if (!args.author && !args.genre) {
        return Book.find({}).populate("author");
      }
      if (args.author) {
        //not worked yet
        return books.filter((book) => book.author === args.author);
      }
      if (args.genre) {
        const bookArr = Book.find({ genres: { $in: [args.genre] } });
        return bookArr;
      }
    },
    allAuthors: async () => {
      const authors = await Author.find({});
      const authorsToReturn = authors.map((item) => ({
        name: item.name,
        born: item.born,
        bookCount: item.books.length,
      }));
      // const allBooks = await Promise.all(
      //   authors.map(async (item) => {
      //     const numberBooks = await Book.find({
      //       author: { $in: item._id },
      //     }).countDocuments();
      //     return Promise.resolve({
      //       name: item.name,
      //       born: item.born,
      //       bookCount: numberBooks,
      //     });
      //   })
      // );
      return authorsToReturn;
    },
    me: (root, args, context) => {
      return context.currentUser;
    },

    favoriteBooks: (root, args, context) => {
      const currentUser = context.currentUser;

      if (!currentUser) {
        throw new AuthenticationError("not authenticated");
      }

      const bookArr = Book.find({
        genres: { $in: [currentUser.favoriteGenre] },
      }).populate("author");
      return bookArr;
    },
  },
  Mutation: {
    addBook: async (root, args, context) => {
      const currentUser = context.currentUser;

      if (!currentUser) {
        throw new AuthenticationError("not authenticated");
      }

      let author = await Author.findOne({ name: args.author });
      if (author === null) {
        author = new Author({
          name: args.author,
          id: uuid(),
          born: null,
          books: [],
        });
        try {
          await author.save();
        } catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          });
        }
      }

      const book = new Book({ ...args, id: uuid(), author: author._id });

      try {
        await book.save();
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        });
      }

      const newBook = await Book.findOne({ title: book.title }).populate(
        "author"
      );
      const savedAuthor = await Author.findOne({ name: args.author });
      savedAuthor.books = savedAuthor.books.concat(newBook._id);
      await savedAuthor.save();

      pubsub.publish("BOOK_ADDED", { bookAdded: newBook });

      return newBook;
    },
    addAuthor: async (root, args) => {
      const author = new Author({ ...args, id: uuid() });

      try {
        await author.save();
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        });
      }

      return author;
    },

    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser;

      if (!currentUser) {
        throw new AuthenticationError("not authenticated");
      }

      const author = await Author.findOne({ name: args.name });
      author.born = args.setBornTo;

      try {
        await author.save();
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        });
      }
      return author;
    },

    createUser: (root, args) => {
      const user = new User({
        username: args.username,
        favoriteGenre: args.favoriteGenre,
      });

      return user.save().catch((error) => {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        });
      });
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username });

      if (!user || args.password !== "secred") {
        throw new UserInputError("wrong credentials");
      }

      const userForToken = {
        username: user.username,
        id: user._id,
      };

      return { value: jwt.sign(userForToken, JWT_SECRET) };
    },
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(["BOOK_ADDED"]),
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null;
    if (auth && auth.toLowerCase().startsWith("bearer ")) {
      const decodedToken = jwt.verify(auth.substring(7), JWT_SECRET);
      const currentUser = await User.findById(decodedToken.id);
      return { currentUser };
    }
  },
});

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`);
  console.log(`Subscriptions ready at ${subscriptionsUrl}`);
});
